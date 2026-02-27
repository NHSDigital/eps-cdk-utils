import {Duration} from "aws-cdk-lib"
import {
  IManagedPolicy,
  ManagedPolicy,
  PolicyStatement,
  Role
} from "aws-cdk-lib/aws-iam"
import {
  Architecture,
  CfnFunction,
  ILayerVersion,
  Runtime
} from "aws-cdk-lib/aws-lambda"
import {NodejsFunction, NodejsFunctionProps} from "aws-cdk-lib/aws-lambda-nodejs"
import {Construct} from "constructs"
import {join} from "node:path"
import {createSharedLambdaResources} from "./lambdaSharedResources"
import {addSuppressions} from "../utils/helpers"

export interface TypescriptLambdaFunctionProps {
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
   * The entry point file for the Lambda function, relative to the package base path.
   *
   */
  readonly entryPoint: string
  /**
   * A map of environment variables to set for the lambda function.
   */
  readonly environmentVariables: { [key: string]: string }
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
  readonly logLevel: string,
  /**
   * The version tag being deployed. Passed as environment variable VERSION_NUMBER to the function.
   */
  readonly version: string
  /**
   * The commit ID being deployed. Passed as environment variable COMMIT_ID to the function.
   */
  readonly commitId: string
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
   * @default Runtime.NODEJS_24_X
   */
  readonly runtime?: Runtime
  /**
   * Optional architecture for the Lambda function. Defaults to x86_64.
   * @default Architecture.X86_64
   */
  readonly architecture?: Architecture
}

const getDefaultLambdaOptions = (
  packageBasePath: string,
  projectBaseDir: string,
  timeoutInSeconds: number,
  runtime: Runtime,
  architecture: Architecture
): NodejsFunctionProps => {
  return {
    runtime: runtime,
    projectRoot: projectBaseDir,
    memorySize: 256,
    timeout: Duration.seconds(timeoutInSeconds),
    architecture: architecture,
    handler: "handler",
    bundling: {
      minify: true,
      sourceMap: true,
      tsconfig: join(projectBaseDir, packageBasePath, "tsconfig.json"),
      target: "es2022"
    }
  }
}

/**
 * A construct that creates a TypeScript-based AWS Lambda function with all necessary AWS resources.
 *
 */
export class TypescriptLambdaFunction extends Construct {
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
  public readonly function: NodejsFunction

  /**
   * The IAM role assumed by the Lambda function during execution.
   */
  public readonly executionRole: Role

  /**
   * Creates a new TypescriptLambdaFunction construct.
   *
   * This construct creates:
   * - A Lambda function with TypeScript bundling
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
   * const lambdaFunction = new TypescriptLambdaFunction(this, 'MyFunction', {
   *   functionName: 'my-lambda',
   *   projectBaseDir: '/path/to/monorepo',
   *   packageBasePath: 'packages/my-lambda',
   *   entryPoint: 'src/handler.ts',
   *   environmentVariables: {
   *     TABLE_NAME: 'my-table'
   *   },
   *   logRetentionInDays: 30,
   *   logLevel: 'INFO',
   *   version: '1.0.0',
   *   commitId: 'abc123'
   * });
   * @param scope - The scope in which to define this construct
   * @param id - The scoped construct ID. Must be unique amongst siblings in the same scope
   * @param props - Configuration properties for the Lambda function
   */
  public constructor(scope: Construct, id: string, props: TypescriptLambdaFunctionProps) {
    super(scope, id)

    // Destructure with defaults
    const {
      functionName,
      packageBasePath,
      entryPoint,
      environmentVariables,
      additionalPolicies = [], // Default to empty array
      logRetentionInDays = 30, // Default retention
      logLevel = "INFO", // Default log level
      version,
      commitId,
      layers = [], // Default to empty array
      projectBaseDir,
      timeoutInSeconds = 50,
      runtime = Runtime.NODEJS_24_X,
      architecture = Architecture.X86_64
    } = props

    const {logGroup, role, insightsLayer} = createSharedLambdaResources(this, {
      functionName,
      logRetentionInDays,
      additionalPolicies,
      architecture
    })

    const lambdaFunction = new NodejsFunction(this, functionName, {
      ...getDefaultLambdaOptions(packageBasePath, projectBaseDir, timeoutInSeconds, runtime, architecture),
      functionName: `${functionName}`,
      entry: join(projectBaseDir, packageBasePath, entryPoint),
      role,
      environment: {
        ...environmentVariables,
        LOG_LEVEL: logLevel,
        NODE_OPTIONS: "--enable-source-maps",
        VERSION_NUMBER: version,
        COMMIT_ID: commitId
      },
      logGroup,
      layers: [
        insightsLayer,
        ...layers
      ]
    })

    const cfnLambda = lambdaFunction.node.defaultChild as CfnFunction
    addSuppressions([cfnLambda], [
      "LAMBDA_DLQ_CHECK",
      "LAMBDA_INSIDE_VPC",
      "LAMBDA_CONCURRENCY_CHECK"
    ])

    const executionManagedPolicy = new ManagedPolicy(this, "ExecuteLambdaManagedPolicy", {
      description: `execute lambda ${functionName}`,
      statements: [
        new PolicyStatement({
          actions: ["lambda:InvokeFunction"],
          resources: [lambdaFunction.functionArn]
        })]
    })

    // Outputs
    this.function = lambdaFunction
    this.executionPolicy = executionManagedPolicy
    this.executionRole = role
  }
}
