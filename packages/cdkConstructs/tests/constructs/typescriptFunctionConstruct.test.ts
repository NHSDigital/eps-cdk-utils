import {App, assertions, Stack} from "aws-cdk-lib"
import {
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal
} from "aws-cdk-lib/aws-iam"
import {LogGroup} from "aws-cdk-lib/aws-logs"
import {
  Architecture,
  Function,
  LayerVersion,
  Runtime
} from "aws-cdk-lib/aws-lambda"
import {Template, Match} from "aws-cdk-lib/assertions"
import {
  describe,
  test,
  beforeAll,
  expect
} from "vitest"

import {TypescriptLambdaFunction} from "../../src/constructs/TypescriptLambdaFunction"
import {resolve} from "node:path"
import {Key} from "aws-cdk-lib/aws-kms"
import {CfnDeliveryStream} from "aws-cdk-lib/aws-kinesisfirehose"

describe("TypescriptLambdaFunctionConstruct works correctly", () => {
  let stack: Stack
  let app: App
  let template: assertions.Template
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lambdaLogGroupResource: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lambdaRoleResource: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lambdaResource: any
  // In this case we can use beforeAll() over beforeEach() since our tests
  // do not modify the state of the application
  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "lambdaConstructStack")
    const functionConstruct = new TypescriptLambdaFunction(stack, "dummyFunction", {
      functionName: "testLambda",
      additionalPolicies: [
      ],
      packageBasePath: "packages/cdkConstructs",
      entryPoint: "tests/src/dummyLambda.ts",
      environmentVariables: {},
      logRetentionInDays: 30,
      logLevel: "DEBUG",
      version: "1.0.0",
      commitId: "abcd1234",
      projectBaseDir: resolve(__dirname, "../../../..")
    })
    template = Template.fromStack(stack)
    const lambdaLogGroup = functionConstruct.node.tryFindChild("LambdaLogGroup") as LogGroup
    const lambdaRole = functionConstruct.node.tryFindChild("LambdaRole") as Role
    const cfnLambda = functionConstruct.node.tryFindChild("testLambda") as Function
    lambdaRoleResource = stack.resolve(lambdaRole.roleName)
    lambdaLogGroupResource = stack.resolve(lambdaLogGroup.logGroupName)
    lambdaResource = stack.resolve(cfnLambda.functionName)
  })

  test("We have found log group, role and lambda", () => {
    expect(lambdaRoleResource).not.toBe(undefined)
    expect(lambdaLogGroupResource).not.toBe(undefined)
    expect(lambdaResource).not.toBe(undefined)
  })

  test("it has the correct log group", () => {
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/lambda/testLambda",
      KmsKeyId: {"Fn::ImportValue": "account-resources-cdk-uk:KMS:CloudwatchLogsKmsKey:Arn"},
      RetentionInDays: 30
    })
  })

  test("it has the correct policy for writing logs", () => {
    template.hasResourceProperties("AWS::IAM::ManagedPolicy", {
      Description: "write to testLambda logs",
      PolicyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
          Effect: "Allow",
          Resource: [
            {"Fn::GetAtt": [lambdaLogGroupResource.Ref, "Arn"]},
            {"Fn::Join": ["", [{"Fn::GetAtt": [lambdaLogGroupResource.Ref, "Arn"]}, ":log-stream:*"]]}
          ]
        }]
      }
    })
  })

  test("it has the correct subscription filter", () => {
    template.hasResourceProperties("AWS::Logs::SubscriptionFilter", {
      LogGroupName: {"Ref": lambdaLogGroupResource.Ref},
      FilterPattern: "",
      RoleArn: {"Fn::ImportValue": "account-resources-cdk-uk:IAM:SplunkSubscriptionFilterRole:Arn"},
      DestinationArn: {"Fn::ImportValue": "account-resources-cdk-uk:Firehose:SplunkDeliveryStream:Arn"}
    })
  })

  test("it has the correct role", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      "AssumeRolePolicyDocument": {
        "Statement": [
          {
            "Action": "sts:AssumeRole",
            "Effect": "Allow",
            "Principal": {
              "Service": "lambda.amazonaws.com"
            }
          }
        ],
        "Version": "2012-10-17"
      },
      "ManagedPolicyArns": Match.arrayWith([
        {"Fn::ImportValue": "account-resources-cdk-uk:IAM:LambdaInsightsLogGroupPolicy:Arn"},
        {"Fn::ImportValue": "account-resources-cdk-uk:IAM:CloudwatchEncryptionKMSPolicy:Arn"}
      ])
    })
  })

  test("it has the correct lambda", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "index.handler",
      Runtime: "nodejs24.x",
      FunctionName: "testLambda",
      MemorySize: 256,
      Architectures: ["x86_64"],
      Timeout: 50,
      LoggingConfig: {
        "LogGroup": lambdaLogGroupResource
      },
      Layers: ["arn:aws:lambda:eu-west-2:580247275435:layer:LambdaInsightsExtension:64"],
      Role: {"Fn::GetAtt": [lambdaRoleResource.Ref, "Arn"]}
    })
  })

  test("it has the correct policy for executing the lambda", () => {
    template.hasResourceProperties("AWS::IAM::ManagedPolicy", {
      Description: "execute lambda testLambda",
      PolicyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Action: "lambda:InvokeFunction",
          Effect: "Allow",
          Resource: {"Fn::GetAtt": [lambdaResource.Ref, "Arn"]}
        }]
      }
    })
  })
})

describe("functionConstruct works correctly with environment variables", () => {
  let stack: Stack
  let app: App
  let template: assertions.Template
  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "lambdaConstructStack")
    new TypescriptLambdaFunction(stack, "dummyFunction", {
      functionName: "testLambda",
      additionalPolicies: [],
      packageBasePath: "packages/cdkConstructs",
      entryPoint: "tests/src/dummyLambda.ts",
      environmentVariables: {foo: "bar"},
      logRetentionInDays: 30,
      logLevel: "DEBUG",
      version: "1.0.0",
      commitId: "abcd1234",
      projectBaseDir: resolve(__dirname, "../../../..")
    })
    template = Template.fromStack(stack)
  })

  test("environment variables are added correctly", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs24.x",
      FunctionName: "testLambda",
      Environment: {Variables: {foo: "bar"}}
    })
  })
})

describe("functionConstruct works correctly with additional policies", () => {
  let stack: Stack
  let app: App
  let template: assertions.Template
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let testPolicyResource: any
  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "lambdaConstructStack")
    const testPolicy = new ManagedPolicy(stack, "testPolicy", {
      description: "test policy",
      statements: [
        new PolicyStatement({
          actions: [
            "logs:CreateLogStream"
          ],
          resources: ["*"]
        })]
    })
    new TypescriptLambdaFunction(stack, "dummyFunction", {
      functionName: "testLambda",
      additionalPolicies: [testPolicy],
      packageBasePath: "packages/cdkConstructs",
      entryPoint: "tests/src/dummyLambda.ts",
      environmentVariables: {},
      logRetentionInDays: 30,
      logLevel: "DEBUG",
      version: "1.0.0",
      commitId: "abcd1234",
      projectBaseDir: resolve(__dirname, "../../../..")
    })
    template = Template.fromStack(stack)
    testPolicyResource = stack.resolve(testPolicy.managedPolicyArn)
  })

  test("it has the correct policies in the role", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      "ManagedPolicyArns": Match.arrayWith([
        {"Fn::ImportValue": "account-resources-cdk-uk:IAM:LambdaInsightsLogGroupPolicy:Arn"},
        {"Fn::ImportValue": "account-resources-cdk-uk:IAM:CloudwatchEncryptionKMSPolicy:Arn"},
        {Ref: testPolicyResource.Ref}
      ])
    })
  })
})

describe("functionConstruct works correctly with additional layers", () => {
  let stack: Stack
  let app: App
  let template: assertions.Template

  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "lambdaConstructStack")
    const parameterAndSecretsLayerArn =
      "arn:aws:lambda:eu-west-2:133256977650:layer:AWS-Parameters-and-Secrets-Lambda-Extension:20"
    const parameterAndSecretsLayer = LayerVersion.fromLayerVersionArn(
      stack, "LayerFromArn", parameterAndSecretsLayerArn)
    new TypescriptLambdaFunction(stack, "dummyFunction", {
      functionName: "testLambda",
      packageBasePath: "packages/cdkConstructs",
      entryPoint: "tests/src/dummyLambda.ts",
      environmentVariables: {},
      logRetentionInDays: 30,
      logLevel: "DEBUG",
      version: "1.0.0",
      layers: [parameterAndSecretsLayer],
      commitId: "abcd1234",
      projectBaseDir: resolve(__dirname, "../../../..")
    })
    template = Template.fromStack(stack)
  })

  test("it has the correct layers added", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "index.handler",
      Runtime: "nodejs24.x",
      FunctionName: "testLambda",
      MemorySize: 256,
      Architectures: ["x86_64"],
      Timeout: 50,
      Layers: [
        "arn:aws:lambda:eu-west-2:580247275435:layer:LambdaInsightsExtension:64",
        "arn:aws:lambda:eu-west-2:133256977650:layer:AWS-Parameters-and-Secrets-Lambda-Extension:20"
      ]
    })
  })
})

describe("functionConstruct works correctly with custom timeout", () => {
  let stack: Stack
  let app: App
  let template: assertions.Template

  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "lambdaConstructStack")
    new TypescriptLambdaFunction(stack, "dummyFunction", {
      functionName: "testLambda",
      packageBasePath: "packages/cdkConstructs",
      entryPoint: "tests/src/dummyLambda.ts",
      environmentVariables: {},
      logRetentionInDays: 30,
      logLevel: "DEBUG",
      version: "1.0.0",
      layers: [],
      commitId: "abcd1234",
      projectBaseDir: resolve(__dirname, "../../../.."),
      timeoutInSeconds: 120
    })
    template = Template.fromStack(stack)
  })

  test("it has the correct timeout", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "index.handler",
      Runtime: "nodejs24.x",
      FunctionName: "testLambda",
      MemorySize: 256,
      Architectures: ["x86_64"],
      Timeout: 120
    })
  })
})

describe("functionConstruct works correctly with different runtime", () => {
  let stack: Stack
  let app: App
  let template: assertions.Template
  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "lambdaConstructStack")
    new TypescriptLambdaFunction(stack, "dummyFunction", {
      functionName: "testLambda",
      additionalPolicies: [],
      packageBasePath: "packages/cdkConstructs",
      entryPoint: "tests/src/dummyLambda.ts",
      environmentVariables: {},
      logRetentionInDays: 30,
      logLevel: "DEBUG",
      version: "1.0.0",
      commitId: "abcd1234",
      projectBaseDir: resolve(__dirname, "../../../.."),
      runtime: Runtime.NODEJS_22_X
    })
    template = Template.fromStack(stack)
  })

  test("it has correct runtime", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      FunctionName: "testLambda"
    })
  })
})

describe("TypescriptLambdaFunctionConstruct works correctly with different architecture", () => {
  let stack: Stack
  let app: App
  let template: assertions.Template

  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "typescriptLambdaConstructStack")
    new TypescriptLambdaFunction(stack, "dummyTypescriptFunction", {
      functionName: "testTypescriptLambda",
      projectBaseDir: resolve(__dirname, "../../../.."),
      packageBasePath: "packages/cdkConstructs",
      entryPoint: "tests/src/dummyLambda.ts",
      environmentVariables: {},
      logRetentionInDays: 30,
      logLevel: "INFO",
      architecture: Architecture.ARM_64,
      version: "1.0.0",
      commitId: "abcd1234"
    })
    template = Template.fromStack(stack)
  })

  test("it has correct architecture and layer", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Architectures: ["arm64"],
      Layers: ["arn:aws:lambda:eu-west-2:580247275435:layer:LambdaInsightsExtension-Arm64:31"]
    })
  })
})

describe("TypescriptLambdaFunctionConstruct works correctly with addSplunkSubscriptionFilter set to false", () => {
  let stack: Stack
  let app: App
  let template: assertions.Template

  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "typescriptLambdaConstructStack")
    new TypescriptLambdaFunction(stack, "dummyTypescriptFunction", {
      functionName: "testTypescriptLambda",
      projectBaseDir: resolve(__dirname, "../../../.."),
      packageBasePath: "packages/cdkConstructs",
      entryPoint: "tests/src/dummyLambda.ts",
      environmentVariables: {},
      logRetentionInDays: 30,
      logLevel: "INFO",
      architecture: Architecture.X86_64,
      version: "1.0.0",
      commitId: "abcd1234",
      addSplunkSubscriptionFilter: false
    })
    template = Template.fromStack(stack)
  })

  test("it does not have a subscription filter", () => {
    template.resourceCountIs("AWS::Logs::SubscriptionFilter", 0)
  })
})

describe("TypescriptLambdaFunctionConstruct works correctly when not using imports", () => {
  let stack: Stack
  let app: App
  let template: assertions.Template
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lambdaLogGroupResource: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cloudWatchLogsKmsKeyResource: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lambdaInsightsLogGroupPolicyResource: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cloudwatchEncryptionKMSPolicyResource: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let splunkSubscriptionFilterRoleResource: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let splunkDeliveryStreamResource: any

  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "typescriptLambdaConstructStack")
    const cloudWatchLogsKmsKey = new Key(stack, "cloudWatchLogsKmsKey")
    const cloudwatchEncryptionKMSPolicy = new ManagedPolicy(stack, "cloudwatchEncryptionKMSPolicy", {
      description: "cloudwatch encryption KMS policy",
      statements: [
        new PolicyStatement({
          actions: [
            "kms:Decrypt",
            "kms:Encrypt",
            "kms:GenerateDataKey*",
            "kms:ReEncrypt*"
          ],
          resources: ["*"]
        })]
    })
    const splunkDeliveryStream = new CfnDeliveryStream(stack, "SplunkDeliveryStream", {
      deliveryStreamName: "SplunkDeliveryStream",
      s3DestinationConfiguration: {
        bucketArn: "arn:aws:s3:::my-bucket",
        roleArn: "arn:aws:iam::123456789012:role/my-role"
      }
    })
    const splunkSubscriptionFilterRole = new Role(stack, "SplunkSubscriptionFilterRole", {
      assumedBy: new ServicePrincipal("logs.amazonaws.com")
    })
    const lambdaInsightsLogGroupPolicy = new ManagedPolicy(stack, "LambdaInsightsLogGroupPolicy", {
      description: "permissions to create log group and set retention policy for Lambda Insights",
      statements: [
        new PolicyStatement({
          actions: [
            "logs:CreateLogStream",
            "logs:PutLogEvents"
          ],
          resources: [
            "*"
          ]
        })
      ]
    })

    const functionConstruct = new TypescriptLambdaFunction(stack, "dummyTypescriptFunction", {
      functionName: "testTypescriptLambda",
      projectBaseDir: resolve(__dirname, "../../../.."),
      packageBasePath: "packages/cdkConstructs",
      entryPoint: "tests/src/dummyLambda.ts",
      environmentVariables: {},
      logRetentionInDays: 30,
      logLevel: "INFO",
      architecture: Architecture.X86_64,
      version: "1.0.0",
      commitId: "abcd1234",
      cloudWatchLogsKmsKey: cloudWatchLogsKmsKey,
      cloudwatchEncryptionKMSPolicy: cloudwatchEncryptionKMSPolicy,
      splunkDeliveryStream: splunkDeliveryStream,
      splunkSubscriptionFilterRole: splunkSubscriptionFilterRole,
      lambdaInsightsLogGroupPolicy: lambdaInsightsLogGroupPolicy
    })
    template = Template.fromStack(stack)
    const lambdaLogGroup = functionConstruct.node.tryFindChild("LambdaLogGroup") as LogGroup
    lambdaLogGroupResource = stack.resolve(lambdaLogGroup.logGroupName)
    cloudWatchLogsKmsKeyResource = stack.resolve(cloudWatchLogsKmsKey.keyId)
    lambdaInsightsLogGroupPolicyResource = stack.resolve(lambdaInsightsLogGroupPolicy.managedPolicyArn)
    cloudwatchEncryptionKMSPolicyResource = stack.resolve(cloudwatchEncryptionKMSPolicy.managedPolicyArn)
    splunkSubscriptionFilterRoleResource = stack.resolve(splunkSubscriptionFilterRole.roleName)
    splunkDeliveryStreamResource = stack.resolve(splunkDeliveryStream.ref)
  })

  test("it has the correct cloudWatchLogsKmsKey", () => {
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/lambda/testTypescriptLambda",
      KmsKeyId: {"Fn::GetAtt": [cloudWatchLogsKmsKeyResource.Ref, "Arn"]},
      RetentionInDays: 30
    })
  })

  test("it has the correct cloudwatchEncryptionKMSPolicy and lambdaInsightsLogGroupPolicy", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      "AssumeRolePolicyDocument": {
        "Statement": [
          {
            "Action": "sts:AssumeRole",
            "Effect": "Allow",
            "Principal": {
              "Service": "lambda.amazonaws.com"
            }
          }
        ],
        "Version": "2012-10-17"
      },
      "ManagedPolicyArns": Match.arrayWith([
        {"Ref": lambdaInsightsLogGroupPolicyResource.Ref},
        {"Ref": cloudwatchEncryptionKMSPolicyResource.Ref}
      ])
    })
  })
  test("it has the correct subscription filter", () => {
    template.hasResourceProperties("AWS::Logs::SubscriptionFilter", {
      LogGroupName: {"Ref": lambdaLogGroupResource.Ref},
      FilterPattern: "",
      RoleArn: {"Fn::GetAtt": [splunkSubscriptionFilterRoleResource.Ref, "Arn"]},
      DestinationArn: {"Fn::GetAtt": [splunkDeliveryStreamResource.Ref, "Arn"]}
    })
  })
})
