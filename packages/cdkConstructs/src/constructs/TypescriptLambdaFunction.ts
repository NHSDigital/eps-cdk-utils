import {Duration, Fn, RemovalPolicy} from "aws-cdk-lib"
import {
  IManagedPolicy,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal
} from "aws-cdk-lib/aws-iam"
import {Stream} from "aws-cdk-lib/aws-kinesis"
import {Key} from "aws-cdk-lib/aws-kms"
import {
  Architecture,
  CfnFunction,
  ILayerVersion,
  LayerVersion,
  Runtime
} from "aws-cdk-lib/aws-lambda"
import {NodejsFunction, NodejsFunctionProps} from "aws-cdk-lib/aws-lambda-nodejs"
import {CfnLogGroup, CfnSubscriptionFilter, LogGroup} from "aws-cdk-lib/aws-logs"
import {Construct} from "constructs"
import {join} from "path"
import {NagSuppressions} from "cdk-nag"

export interface TypescriptLambdaFunctionProps {
  /**
   * Name of the Lambda function.
   *
   */
  readonly functionName: string
  /**
   * The relative path to the base of the package where the Lambda function code is located.
   *
   */
  readonly packageBasePath: string
  /**
   * The entry point file for the Lambda function, relative to the package base path.
   *
   */
  readonly entryPoint: string
  /**
   * A map of environment variables to set for the Lambda function.
   */
  readonly environmentVariables: {[key: string]: string}
  /**
   * Optional additional IAM policies to attach to the Lambda function.
   */
  readonly additionalPolicies?: Array<IManagedPolicy>
  /**
   * The number of days to retain logs in CloudWatch Logs.
   * @default 30 days
   */
  readonly logRetentionInDays: number
  /**
   * The log level for the Lambda function.
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
   * The base directory for resolving the package base path and entry point.
   * Should point to the monorepo root.
   */
  readonly baseDir: string
}

const insightsLayerArn = "arn:aws:lambda:eu-west-2:580247275435:layer:LambdaInsightsExtension:60"
const getDefaultLambdaOptions = (packageBasePath: string, baseDir: string):NodejsFunctionProps => {
  return {
    runtime: Runtime.NODEJS_22_X,
    projectRoot: baseDir,
    memorySize: 256,
    timeout: Duration.seconds(50),
    architecture: Architecture.X86_64,
    handler: "handler",
    bundling: {
      minify: true,
      sourceMap: true,
      tsconfig: join(baseDir, packageBasePath, "tsconfig.json"),
      target: "es2022"
    }
  }
}

export class TypescriptLambdaFunction extends Construct {
  /**
     * The managed policy that allows execution of the Lambda function.
     */
  public readonly executionPolicy: ManagedPolicy
  /**
     * The Lambda function instance.
     */
  public readonly function: NodejsFunction

  public constructor(scope: Construct, id: string, props: TypescriptLambdaFunctionProps){
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
      baseDir
    } = props

    // Imports
    const cloudWatchLogsKmsKey = Key.fromKeyArn(
      this, "cloudWatchLogsKmsKey", Fn.importValue("account-resources:CloudwatchLogsKmsKeyArn"))

    const splunkDeliveryStream = Stream.fromStreamArn(
      this, "SplunkDeliveryStream", Fn.importValue("lambda-resources:SplunkDeliveryStream"))

    const splunkSubscriptionFilterRole = Role.fromRoleArn(
      this, "splunkSubscriptionFilterRole", Fn.importValue("lambda-resources:SplunkSubscriptionFilterRole"))

    const lambdaInsightsLogGroupPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "lambdaInsightsLogGroupPolicy", Fn.importValue("lambda-resources:LambdaInsightsLogGroupPolicy"))

    const cloudwatchEncryptionKMSPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "cloudwatchEncryptionKMSPolicyArn", Fn.importValue("account-resources:CloudwatchEncryptionKMSPolicyArn"))

    const lambdaDecryptSecretsKMSPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "lambdaDecryptSecretsKMSPolicy", Fn.importValue("account-resources:LambdaDecryptSecretsKMSPolicy"))

    const insightsLambdaLayer = LayerVersion.fromLayerVersionArn(
      this, "LayerFromArn", insightsLayerArn)

    // Resources
    const logGroup = new LogGroup(this, "LambdaLogGroup", {
      encryptionKey: cloudWatchLogsKmsKey,
      logGroupName: `/aws/lambda/${functionName!}`,
      retention: logRetentionInDays,
      removalPolicy: RemovalPolicy.DESTROY
    })

    const cfnlogGroup = logGroup.node.defaultChild as CfnLogGroup
    cfnlogGroup.cfnOptions.metadata = {
      guard: {
        SuppressedRules: [
          "CW_LOGGROUP_RETENTION_PERIOD_CHECK"
        ]
      }
    }

    new CfnSubscriptionFilter(this, "LambdaLogsSplunkSubscriptionFilter", {
      destinationArn: splunkDeliveryStream.streamArn,
      filterPattern: "",
      logGroupName: logGroup.logGroupName,
      roleArn: splunkSubscriptionFilterRole.roleArn

    })

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
        })]
    })
    NagSuppressions.addResourceSuppressions(putLogsManagedPolicy, [
      {
        id: "AwsSolutions-IAM5",
        // eslint-disable-next-line max-len
        reason: "Suppress error for not having wildcards in permissions. This is a fine as we need to have permissions on all log streams under path"
      }
    ])

    const role = new Role(this, "LambdaRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        putLogsManagedPolicy,
        lambdaInsightsLogGroupPolicy,
        cloudwatchEncryptionKMSPolicy,
        lambdaDecryptSecretsKMSPolicy,
        ...(additionalPolicies)
      ]
    })

    const lambdaFunction = new NodejsFunction(this, functionName, {
      ...getDefaultLambdaOptions(packageBasePath, baseDir),
      functionName: `${functionName}`,
      entry: join(baseDir, packageBasePath, entryPoint),
      role,
      environment: {
        ...environmentVariables,
        LOG_LEVEL: logLevel,
        NODE_OPTIONS: "--enable-source-maps",
        VERSION_NUMBER: version,
        COMMIT_ID: commitId
      },
      logGroup,
      layers:[
        insightsLambdaLayer,
        ...layers
      ]
    })

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
  }
}
