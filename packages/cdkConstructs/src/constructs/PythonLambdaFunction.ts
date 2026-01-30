import {Construct} from "constructs"
import {Duration, RemovalPolicy} from "aws-cdk-lib"
import {
  ManagedPolicy,
  PolicyStatement,
  Role,
  IManagedPolicy
} from "aws-cdk-lib/aws-iam"
import {
  Architecture,
  CfnFunction,
  LayerVersion,
  Runtime,
  Function as LambdaFunctionResource,
  Code,
  ILayerVersion
} from "aws-cdk-lib/aws-lambda"
import {join} from "node:path"
import {createSharedLambdaResources} from "./lambdaSharedResources"

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

    const {logGroup, role, insightsLayer} = createSharedLambdaResources(this, {
      functionName,
      logRetentionInDays,
      additionalPolicies,
      architecture
    })

    const layersToAdd = [insightsLayer]
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
      functionName: functionName,
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
