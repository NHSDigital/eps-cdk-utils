import {Construct} from "constructs"
import {Duration, Fn, RemovalPolicy} from "aws-cdk-lib"
import {
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
  IManagedPolicy
} from "aws-cdk-lib/aws-iam"
import {Key} from "aws-cdk-lib/aws-kms"
import {Stream} from "aws-cdk-lib/aws-kinesis"
import {
  Architecture,
  CfnFunction,
  LayerVersion,
  Runtime,
  Function as LambdaFunctionResource,
  Code,
  ILayerVersion
} from "aws-cdk-lib/aws-lambda"
import {CfnLogGroup, CfnSubscriptionFilter, LogGroup} from "aws-cdk-lib/aws-logs"
import {join} from "path"
import {LAMBDA_INSIGHTS_LAYER_ARNS} from "../config"

export interface PythonLambdaFunctionProps {
  /**
   * Name of the lambda function. The log group name is also based on this name.
   *
   */
  readonly functionName: string
  /**
   * The base directory for resolving the package base path and entry point.
   * Should point to the monorepo root.
   */
  readonly projectBaseDir: string
  /**
   * The relative path from projectBaseDir to the base folder where the lambda function code is located.
   *
   */
  readonly packageBasePath: string
  /**
   * The function handler (file and method).  Example: `index.handler` for `index.py` file and `handler` method.
   */
  readonly handler: string
  /**
   * A map of environment variables to set for the lambda function.
   */
  readonly environmentVariables?: {[key: string]: string}
  /**
   * Optional additional IAM policies to attach to role the lambda executes as.
   */
  readonly additionalPolicies?: Array<IManagedPolicy>
  /**
   * The number of days to retain logs in CloudWatch Logs.
   * @default 30 days
   */
  readonly logRetentionInDays: number
  /**
   * The log level for the lambda function.
   * @default "INFO"
   */
  readonly logLevel: string
  /**
   * Optional location of dependencies to include as a separate Lambda layer.
   */
  readonly dependencyLocation?: string
  /**
   * Optional list of Lambda layers to attach to the function.
   */
  readonly layers?: Array<ILayerVersion>
  /**
   * Optional timeout in seconds for the Lambda function.
   * @default 50 seconds
   */
  readonly timeoutInSeconds?: number
  /**
   * Optional runtime for the Lambda function.
   * @default Runtime.PYTHON_3_14
   */
  readonly runtime?: Runtime
  /**
   * Optional architecture for the Lambda function. Defaults to x86_64.
   * @default Architecture.X86_64
   */
  readonly architecture?: Architecture
}

export class PythonLambdaFunction extends Construct {
  /**
   * The managed policy that allows execution of the Lambda function.
   *
   * Use this policy to grant other AWS resources permission to invoke this Lambda function.
   *
   * @example
   * ```typescript
   * // Grant API Gateway permission to invoke the Lambda
   * apiGatewayRole.addManagedPolicy(lambdaConstruct.executionPolicy);
   * ```
   */
  public readonly executionPolicy: ManagedPolicy

  /**
   * The Lambda function instance.
   *
   * Provides access to the underlying AWS Lambda function for additional configuration
   * or to reference its ARN, name, or other properties.
   *
   * @example
   * ```typescript
   * // Get the function ARN
   * const functionArn = lambdaConstruct.function.functionArn;
   *
   * // Add additional environment variables
   * lambdaConstruct.function.addEnvironment('NEW_VAR', 'value');
   * ```
   */
  public readonly function: LambdaFunctionResource

  /**
   * The IAM role assumed by the Lambda function during execution.
   */
  public readonly executionRole: Role

  /**
   * Creates a new PythonLambdaFunction construct.
   *
   * This construct creates:
   * - A python Lambda function with
   * - CloudWatch log group with KMS encryption
   * - Managed IAM policy for writing logs
   * - IAM role for execution with necessary permissions
   * - Subscription filter on logs so they are forwarded to splunk
   * - Managed IAM policy for invoking the Lambda function
   *
   * It also
   * - attaches the Lambda Insights layer for monitoring.
   * - adds cfnGuard suppressions for common issues.
   * - adds cdk-nag suppressions for common issues.
   *
   * @example
   * ```typescript
   * const lambdaFunction = new PythonLambdaFunction(this, 'MyFunction', {
   *   functionName: 'my-lambda',
   *   projectBaseDir: '/path/to/monorepo'
   *   packageBasePath: 'packages/my-lambda',
   *   handler: 'app.handler.handler',
   *   environmentVariables: {
   *     TABLE_NAME: 'my-table'
   *   },
   *   logRetentionInDays: 30,
   *   logLevel: 'INFO'
   * });
   * @param scope - The scope in which to define this construct
   * @param id - The scoped construct ID. Must be unique amongst siblings in the same scope
   * @param props - Configuration properties for the Lambda function
   */
  public constructor(scope: Construct, id: string, props: PythonLambdaFunctionProps) {
    super(scope, id)
    // Destructure with defaults
    const {
      functionName,
      projectBaseDir,
      packageBasePath,
      handler,
      environmentVariables,
      additionalPolicies = [], // Default to empty array
      logRetentionInDays = 30, // Default retention
      logLevel = "INFO", // Default log level
      dependencyLocation,
      layers = [], // Default to empty array
      timeoutInSeconds = 50,
      runtime = Runtime.PYTHON_3_14,
      architecture = Architecture.X86_64
    } = props

    // Import shared cloud resources from cross-stack references
    const cloudWatchLogsKmsKey = Key.fromKeyArn(
      this, "cloudWatchLogsKmsKey", Fn.importValue("account-resources:CloudwatchLogsKmsKeyArn"))

    const cloudwatchEncryptionKMSPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "cloudwatchEncryptionKMSPolicyArn", Fn.importValue("account-resources:CloudwatchEncryptionKMSPolicyArn"))

    const splunkDeliveryStream = Stream.fromStreamArn(
      this, "SplunkDeliveryStream", Fn.importValue("lambda-resources:SplunkDeliveryStream"))

    const splunkSubscriptionFilterRole = Role.fromRoleArn(
      this, "splunkSubscriptionFilterRole", Fn.importValue("lambda-resources:SplunkSubscriptionFilterRole"))

    const lambdaInsightsLogGroupPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "lambdaInsightsLogGroupPolicy", Fn.importValue("lambda-resources:LambdaInsightsLogGroupPolicy"))

    const insightsLambdaLayerArn = architecture === Architecture.ARM_64
      ? LAMBDA_INSIGHTS_LAYER_ARNS.arm64
      : LAMBDA_INSIGHTS_LAYER_ARNS.x64
    const insightsLambdaLayer = LayerVersion.fromLayerVersionArn(
      this, "LayerFromArn", insightsLambdaLayerArn)

    // Log group with encryption and retention
    const logGroup = new LogGroup(this, "LambdaLogGroup", {
      encryptionKey: cloudWatchLogsKmsKey,
      logGroupName: `/aws/lambda/${functionName}`,
      retention: logRetentionInDays,
      removalPolicy: RemovalPolicy.DESTROY
    })

    // Suppress CFN guard rules for log group
    const cfnlogGroup = logGroup.node.defaultChild as CfnLogGroup
    cfnlogGroup.cfnOptions.metadata = {
      guard: {
        SuppressedRules: [
          "CW_LOGGROUP_RETENTION_PERIOD_CHECK"
        ]
      }
    }

    // Send logs to Splunk
    new CfnSubscriptionFilter(this, "LambdaLogsSplunkSubscriptionFilter", {
      destinationArn: splunkDeliveryStream.streamArn,
      filterPattern: "",
      logGroupName: logGroup.logGroupName,
      roleArn: splunkSubscriptionFilterRole.roleArn
    })

    // Create managed policy for Lambda CloudWatch logs access
    const putLogsManagedPolicy = new ManagedPolicy(this, "LambdaPutLogsManagedPolicy", {
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

    // Aggregate all required policies for Lambda execution
    const requiredPolicies: Array<IManagedPolicy> = [
      putLogsManagedPolicy,
      lambdaInsightsLogGroupPolicy,
      cloudwatchEncryptionKMSPolicy,
      ...(additionalPolicies ?? [])
    ]

    const role = new Role(this, "LambdaRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: requiredPolicies
    })

    const layersToAdd = [insightsLambdaLayer]
    if (dependencyLocation) {
      const dependencyLayer = new LayerVersion(this, "DependencyLayer", {
        removalPolicy: RemovalPolicy.DESTROY,
        code: Code.fromAsset(join(projectBaseDir, dependencyLocation)),
        compatibleArchitectures: [architecture]
      })
      layersToAdd.push(dependencyLayer)
    }
    layersToAdd.push(...layers)

    // Create Lambda function with Python runtime and monitoring
    const lambdaFunction = new LambdaFunctionResource(this, functionName, {
      runtime: runtime,
      memorySize: 256,
      timeout: Duration.seconds(timeoutInSeconds),
      architecture,
      handler: handler,
      code: Code.fromAsset(join(projectBaseDir, packageBasePath)),
      role,
      environment: {
        ...environmentVariables,
        POWERTOOLS_LOG_LEVEL: logLevel
      },
      logGroup,
      layers: layersToAdd
    })

    // Suppress CFN guard rules for Lambda function
    const cfnLambda = lambdaFunction.node.defaultChild as CfnFunction
    cfnLambda.cfnOptions.metadata = {
      guard: {
        SuppressedRules: [
          "LAMBDA_DLQ_CHECK",
          "LAMBDA_INSIDE_VPC",
          "LAMBDA_CONCURRENCY_CHECK"
        ]
      }
    }

    // Create policy for external services to invoke this Lambda
    const executionManagedPolicy = new ManagedPolicy(this, "ExecuteLambdaManagedPolicy", {
      description: `execute lambda ${functionName}`,
      statements: [
        new PolicyStatement({
          actions: ["lambda:InvokeFunction"],
          resources: [lambdaFunction.functionArn]
        })
      ]
    })

    // Export Lambda function and sexecution policy for use by other constructs
    this.function = lambdaFunction
    this.executionPolicy = executionManagedPolicy
    this.executionRole = role
  }
}
