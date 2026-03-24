import {Fn, RemovalPolicy} from "aws-cdk-lib"
import {
  IManagedPolicy,
  IRole,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal
} from "aws-cdk-lib/aws-iam"
import {Stream} from "aws-cdk-lib/aws-kinesis"
import {IKey, Key} from "aws-cdk-lib/aws-kms"
import {CfnLogGroup, CfnSubscriptionFilter, LogGroup} from "aws-cdk-lib/aws-logs"
import {
  DefinitionBody,
  IChainable,
  LogLevel,
  QueryLanguage,
  StateMachine,
  StateMachineType
} from "aws-cdk-lib/aws-stepfunctions"
import {Construct} from "constructs"
import {CfnDeliveryStream} from "aws-cdk-lib/aws-kinesisfirehose"

export interface StateMachineProps {
  readonly stackName: string
  readonly stateMachineName: string
  readonly definition: IChainable
  readonly additionalPolicies?: Array<IManagedPolicy>
  readonly logRetentionInDays: number
  /**
   * Optional KMS key for encrypting CloudWatch Logs.
   * Defaults to the shared account-level KMS key via CloudFormation import.
   */
  readonly cloudWatchLogsKmsKey?: IKey
  /**
   * Optional IAM policy allowing CloudWatch to use the KMS key for encrypting logs.
   * Defaults to the shared account-level policy via CloudFormation import.
   */
  readonly cloudwatchEncryptionKMSPolicy?: IManagedPolicy
  /**
   * Optional Kinesis Firehose delivery stream for forwarding logs to Splunk.
   * When not provided, falls back to a Kinesis Stream via CloudFormation import.
   */
  readonly splunkDeliveryStream?: CfnDeliveryStream
  /**
   * Optional IAM role used by the Splunk subscription filter.
   * Defaults to the shared role via CloudFormation import.
   */
  readonly splunkSubscriptionFilterRole?: IRole
  /**
   * Whether to create a subscription filter to forward logs to Splunk.
   * Defaults to true.
   */
  readonly addSplunkSubscriptionFilter?: boolean
}

export class ExpressStateMachine extends Construct {
  public readonly executionPolicy: ManagedPolicy
  public readonly stateMachine: StateMachine

  public constructor(scope: Construct, id: string, props: StateMachineProps) {
    super(scope, id)

    const {
      cloudWatchLogsKmsKey = Key.fromKeyArn(
        this, "CloudWatchLogsKmsKey", Fn.importValue("account-resources:CloudwatchLogsKmsKeyArn")),
      cloudwatchEncryptionKMSPolicy = ManagedPolicy.fromManagedPolicyArn(
        this, "cloudwatchEncryptionKMSPolicy", Fn.importValue("account-resources:CloudwatchEncryptionKMSPolicyArn")),
      splunkDeliveryStream,
      splunkSubscriptionFilterRole = Role.fromRoleArn(
        this, "splunkSubscriptionFilterRole", Fn.importValue("lambda-resources:SplunkSubscriptionFilterRole")),
      addSplunkSubscriptionFilter = true
    } = props

    const logGroup = new LogGroup(this, "StateMachineLogGroup", {
      encryptionKey: cloudWatchLogsKmsKey,
      logGroupName: `/aws/stepfunctions/${props.stateMachineName}`,
      retention: props.logRetentionInDays,
      removalPolicy: RemovalPolicy.DESTROY
    })

    const cfnLogGroup = logGroup.node.defaultChild as CfnLogGroup
    cfnLogGroup.cfnOptions.metadata = {
      guard: {
        SuppressedRules: [
          "CW_LOGGROUP_RETENTION_PERIOD_CHECK"
        ]
      }
    }

    if (addSplunkSubscriptionFilter) {
      if (splunkDeliveryStream) {
        new CfnSubscriptionFilter(this, "LambdaLogsSplunkSubscriptionFilter", {
          destinationArn: splunkDeliveryStream.attrArn,
          filterPattern: "",
          logGroupName: logGroup.logGroupName,
          roleArn: splunkSubscriptionFilterRole.roleArn
        })
      } else {
        const splunkDeliveryStreamImport = Stream.fromStreamArn(
          this, "SplunkDeliveryStream", Fn.importValue("lambda-resources:SplunkDeliveryStream"))
        new CfnSubscriptionFilter(this, "LambdaLogsSplunkSubscriptionFilter", {
          destinationArn: splunkDeliveryStreamImport.streamArn,
          filterPattern: "",
          logGroupName: logGroup.logGroupName,
          roleArn: splunkSubscriptionFilterRole.roleArn
        })
      }
    }

    const putLogsManagedPolicy = new ManagedPolicy(this, "StateMachinePutLogsManagedPolicy", {
      description: `write to ${props.stateMachineName} logs`,
      statements: [
        new PolicyStatement({
          actions: [
            "logs:CreateLogStream",
            "logs:PutLogEvents"
          ],
          resources: [
            logGroup.logGroupArn,
            `${logGroup.logGroupArn}:log-stream`
          ]
        }),
        new PolicyStatement({
          actions: [
            "logs:DescribeLogGroups",
            "logs:ListLogDeliveries",
            "logs:CreateLogDelivery",
            "logs:GetLogDelivery",
            "logs:UpdateLogDelivery",
            "logs:DeleteLogDelivery",
            "logs:PutResourcePolicy",
            "logs:DescribeResourcePolicies"
          ],
          resources: ["*"]
        })
      ]
    })

    const role = new Role(this, "StateMachineRole", {
      assumedBy: new ServicePrincipal("states.amazonaws.com"),
      managedPolicies: [
        putLogsManagedPolicy,
        cloudwatchEncryptionKMSPolicy,
        ...(props.additionalPolicies ?? [])
      ]
    }).withoutPolicyUpdates()

    const stateMachine = new StateMachine(this, "StateMachine", {
      stateMachineName: props.stateMachineName,
      stateMachineType: StateMachineType.EXPRESS,
      queryLanguage: QueryLanguage.JSONATA,
      definitionBody: DefinitionBody.fromChainable(props.definition),
      role: role,
      logs: {
        destination: logGroup,
        level: LogLevel.ALL,
        includeExecutionData: true
      },
      tracingEnabled: true
    })

    const executionManagedPolicy = new ManagedPolicy(this, "ExecuteStateMachineManagedPolicy", {
      description: `execute state machine ${props.stateMachineName}`,
      statements: [
        new PolicyStatement({
          actions: [
            "states:StartSyncExecution",
            "states:StartExecution"
          ],
          resources: [stateMachine.stateMachineArn]
        })
      ]
    })

    this.executionPolicy = executionManagedPolicy
    this.stateMachine = stateMachine
  }
}
