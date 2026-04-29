import {RemovalPolicy} from "aws-cdk-lib"
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
import {ACCOUNT_RESOURCES, CFN_GUARD_RULES} from "../constants"
import {addSuppressions} from "../utils/helpers"

/**
 * Configuration for provisioning an Express Step Functions state machine
 * with logging and optional Splunk forwarding.
 */
export interface StateMachineProps {
  /** Stack name, used as prefix for resource naming and DNS records. */
  readonly stackName: string
  /** Friendly state machine name used for both AWS resource and log naming. */
  readonly stateMachineName: string
  /** Workflow definition chain rendered as the state machine definition body. */
  readonly definition: IChainable
  /** Extra managed policies merged into the execution role when required. */
  readonly additionalPolicies?: Array<IManagedPolicy>
  /** Retention period applied to the workflow CloudWatch log group. */
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

/** Creates an Express Step Functions workflow with CloudWatch logging and invoke permissions. */
export class ExpressStateMachine extends Construct {
  /** Managed policy that grants permission to start this workflow. */
  public readonly executionPolicy: ManagedPolicy

  /** Created Step Functions state machine resource. */
  public readonly stateMachine: StateMachine

  /**
   * Provisions an Express Step Functions workflow with logging, tracing, and invoke permissions.
   * @example
   * ```ts
   * const sm = new ExpressStateMachine(this, "MyWorkflow", {
   *   stackName: "my-service",
   *   stateMachineName: "my-service-workflow",
   *   definition: new Pass(this, "Start"),
   *   logRetentionInDays: 30,
   *   additionalPolicies: [myLambdaInvokePolicy]
   * })
   * // Attach the generated execution policy to an API Gateway role
   * apiGatewayRole.addManagedPolicy(sm.executionPolicy)
   * ```
   */
  public constructor(scope: Construct, id: string, props: StateMachineProps) {
    super(scope, id)

    const {
      cloudWatchLogsKmsKey = Key.fromKeyArn(
        this, "CloudWatchLogsKmsKey", ACCOUNT_RESOURCES.CloudwatchLogsKmsKeyArn),
      cloudwatchEncryptionKMSPolicy = ManagedPolicy.fromManagedPolicyArn(
        this, "cloudwatchEncryptionKMSPolicy", ACCOUNT_RESOURCES.CloudwatchEncryptionKMSPolicyArn),
      splunkDeliveryStream,
      splunkSubscriptionFilterRole = Role.fromRoleArn(
        this, "splunkSubscriptionFilterRole", ACCOUNT_RESOURCES.SplunkSubscriptionFilterRoleArn),
      addSplunkSubscriptionFilter = true
    } = props

    const logGroup = new LogGroup(this, "StateMachineLogGroup", {
      encryptionKey: cloudWatchLogsKmsKey,
      logGroupName: `/aws/stepfunctions/${props.stateMachineName}`,
      retention: props.logRetentionInDays,
      removalPolicy: RemovalPolicy.DESTROY
    })

    const cfnLogGroup = logGroup.node.defaultChild as CfnLogGroup
    addSuppressions([cfnLogGroup], [CFN_GUARD_RULES.LogGroupRetentionPeriodCheck])

    if (addSplunkSubscriptionFilter) {
      if (splunkDeliveryStream) {
        new CfnSubscriptionFilter(this, "StateMachineLogsSplunkSubscriptionFilter", {
          destinationArn: splunkDeliveryStream.attrArn,
          filterPattern: "",
          logGroupName: logGroup.logGroupName,
          roleArn: splunkSubscriptionFilterRole.roleArn
        })
      } else {
        const splunkDeliveryStreamImport = Stream.fromStreamArn(
          this, "SplunkDeliveryStream", ACCOUNT_RESOURCES.SplunkDeliveryStreamArn)
        new CfnSubscriptionFilter(this, "StateMachineLogsSplunkSubscriptionFilter", {
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
            `${logGroup.logGroupArn}:log-stream:*`
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
