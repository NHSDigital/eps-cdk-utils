import {Construct} from "constructs"
import {RemovalPolicy} from "aws-cdk-lib"
import {Architecture, ILayerVersion, LayerVersion} from "aws-cdk-lib/aws-lambda"
import {IKey, Key} from "aws-cdk-lib/aws-kms"
import {CfnLogGroup, CfnSubscriptionFilter, LogGroup} from "aws-cdk-lib/aws-logs"
import {
  IManagedPolicy,
  IRole,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal
} from "aws-cdk-lib/aws-iam"
import {NagSuppressions} from "cdk-nag"
import {LAMBDA_INSIGHTS_LAYER_ARNS} from "../config"
import {ACCOUNT_RESOURCES, CFN_GUARD_RULES} from "../constants"
import {addSuppressions} from "../utils/helpers"
import {CfnDeliveryStream} from "aws-cdk-lib/aws-kinesisfirehose"
import {Stream} from "aws-cdk-lib/aws-kinesis"

export interface SharedLambdaResourceProps {
  readonly functionName: string
  readonly logRetentionInDays: number
  readonly additionalPolicies: Array<IManagedPolicy>
  readonly architecture: Architecture
  readonly cloudWatchLogsKmsKey?: IKey
  readonly cloudwatchEncryptionKMSPolicy?: IManagedPolicy
  readonly splunkDeliveryStream?: CfnDeliveryStream
  readonly splunkSubscriptionFilterRole?: IRole
  readonly lambdaInsightsLogGroupPolicy?: IManagedPolicy
  readonly addSplunkSubscriptionFilter?: boolean
}

export interface SharedLambdaResources {
  readonly logGroup: LogGroup
  readonly role: Role
  readonly insightsLayer: ILayerVersion
}

export const createSharedLambdaResources = (
  scope: Construct,
  props: SharedLambdaResourceProps
): SharedLambdaResources => {
  const {
    functionName,
    logRetentionInDays,
    additionalPolicies,
    architecture,
    cloudWatchLogsKmsKey = Key.fromKeyArn(
      scope, "cloudWatchLogsKmsKey", ACCOUNT_RESOURCES.CloudwatchLogsKmsKeyArn),
    cloudwatchEncryptionKMSPolicy = ManagedPolicy.fromManagedPolicyArn(
      scope,
      "cloudwatchEncryptionKMSPolicyArn",
      ACCOUNT_RESOURCES.CloudwatchEncryptionKMSPolicyArn
    ),
    splunkDeliveryStream,
    splunkSubscriptionFilterRole = Role.fromRoleArn(
      scope, "splunkSubscriptionFilterRole", ACCOUNT_RESOURCES.SplunkSubscriptionFilterRoleArn),
    lambdaInsightsLogGroupPolicy = ManagedPolicy.fromManagedPolicyArn(
      scope, "lambdaInsightsLogGroupPolicy", ACCOUNT_RESOURCES.LambdaInsightsLogGroupPolicyArn),
    addSplunkSubscriptionFilter = true
  } = props
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
  addSuppressions([cfnlogGroup], [CFN_GUARD_RULES.LogGroupRetentionPeriodCheck])

  if (addSplunkSubscriptionFilter) {
    // This is in an if statement to ensure correct value is used
    // importing and coercing to cfnDeliveryStream causes issues
    if (splunkDeliveryStream) {
      new CfnSubscriptionFilter(scope, "LambdaLogsSplunkSubscriptionFilter", {
        destinationArn: splunkDeliveryStream.attrArn,
        filterPattern: "",
        logGroupName: logGroup.logGroupName,
        roleArn: splunkSubscriptionFilterRole.roleArn
      })
    } else {
      const splunkDeliveryStreamImport = Stream.fromStreamArn(
        scope, "SplunkDeliveryStream", ACCOUNT_RESOURCES.SplunkDeliveryStreamArn)
      new CfnSubscriptionFilter(scope, "LambdaLogsSplunkSubscriptionFilter", {
        destinationArn: splunkDeliveryStreamImport.streamArn,
        filterPattern: "",
        logGroupName: logGroup.logGroupName,
        roleArn: splunkSubscriptionFilterRole.roleArn
      })
    }
  }

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
