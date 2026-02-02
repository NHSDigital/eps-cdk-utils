import {Construct} from "constructs"
import {Fn, RemovalPolicy} from "aws-cdk-lib"
import {Architecture, ILayerVersion, LayerVersion} from "aws-cdk-lib/aws-lambda"
import {Key} from "aws-cdk-lib/aws-kms"
import {Stream} from "aws-cdk-lib/aws-kinesis"
import {CfnLogGroup, CfnSubscriptionFilter, LogGroup} from "aws-cdk-lib/aws-logs"
import {
  IManagedPolicy,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal
} from "aws-cdk-lib/aws-iam"
import {NagSuppressions} from "cdk-nag"
import {LAMBDA_INSIGHTS_LAYER_ARNS} from "../config"
import {addSuppressions} from "../utils/helpers"

export interface SharedLambdaResourceProps {
  readonly functionName: string
  readonly logRetentionInDays: number
  readonly additionalPolicies: Array<IManagedPolicy>
  readonly architecture: Architecture
}

export interface SharedLambdaResources {
  readonly logGroup: LogGroup
  readonly role: Role
  readonly insightsLayer: ILayerVersion
}

export const createSharedLambdaResources = (
  scope: Construct,
  {
    functionName,
    logRetentionInDays,
    additionalPolicies,
    architecture
  }: SharedLambdaResourceProps
): SharedLambdaResources => {
  const cloudWatchLogsKmsKey = Key.fromKeyArn(
    scope, "cloudWatchLogsKmsKey", Fn.importValue("account-resources:CloudwatchLogsKmsKeyArn"))

  const cloudwatchEncryptionKMSPolicy = ManagedPolicy.fromManagedPolicyArn(
    scope, "cloudwatchEncryptionKMSPolicyArn", Fn.importValue("account-resources:CloudwatchEncryptionKMSPolicyArn"))

  const splunkDeliveryStream = Stream.fromStreamArn(
    scope, "SplunkDeliveryStream", Fn.importValue("lambda-resources:SplunkDeliveryStream"))

  const splunkSubscriptionFilterRole = Role.fromRoleArn(
    scope, "splunkSubscriptionFilterRole", Fn.importValue("lambda-resources:SplunkSubscriptionFilterRole"))

  const lambdaInsightsLogGroupPolicy = ManagedPolicy.fromManagedPolicyArn(
    scope, "lambdaInsightsLogGroupPolicy", Fn.importValue("lambda-resources:LambdaInsightsLogGroupPolicy"))

  const insightsLambdaLayerArn = architecture === Architecture.ARM_64
    ? LAMBDA_INSIGHTS_LAYER_ARNS.arm64
    : LAMBDA_INSIGHTS_LAYER_ARNS.x64
  const insightsLambdaLayer = LayerVersion.fromLayerVersionArn(
    scope, "LayerFromArn", insightsLambdaLayerArn)

  const logGroup = new LogGroup(scope, "LambdaLogGroup", {
    encryptionKey: cloudWatchLogsKmsKey,
    logGroupName: `/aws/lambda/${functionName}`,
    retention: logRetentionInDays,
    removalPolicy: RemovalPolicy.DESTROY
  })

  const cfnlogGroup = logGroup.node.defaultChild as CfnLogGroup
  addSuppressions([cfnlogGroup], ["CW_LOGGROUP_RETENTION_PERIOD_CHECK"])

  new CfnSubscriptionFilter(scope, "LambdaLogsSplunkSubscriptionFilter", {
    destinationArn: splunkDeliveryStream.streamArn,
    filterPattern: "",
    logGroupName: logGroup.logGroupName,
    roleArn: splunkSubscriptionFilterRole.roleArn
  })

  const putLogsManagedPolicy = new ManagedPolicy(scope, "LambdaPutLogsManagedPolicy", {
    description: `write to ${functionName} logs`,
    statements: [
      new PolicyStatement({
        actions: [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ],
        resources: [
          logGroup.logGroupArn,
          `${logGroup.logGroupArn}:log-stream:*`
        ]
      })
    ]
  })

  NagSuppressions.addResourceSuppressions(putLogsManagedPolicy, [
    {
      id: "AwsSolutions-IAM5",
      // eslint-disable-next-line max-len
      reason: "Suppress error for not having wildcards in permissions. This is a fine as we need to have permissions on all log streams under path"
    }
  ])

  const role = new Role(scope, "LambdaRole", {
    assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
    managedPolicies: [
      putLogsManagedPolicy,
      lambdaInsightsLogGroupPolicy,
      cloudwatchEncryptionKMSPolicy,
      ...additionalPolicies
    ]
  })

  return {
    logGroup,
    role,
    insightsLayer: insightsLambdaLayer
  }
}
