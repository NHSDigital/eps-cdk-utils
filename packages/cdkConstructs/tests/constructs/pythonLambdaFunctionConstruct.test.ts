import {App, assertions, Stack} from "aws-cdk-lib"
import {Template, Match} from "aws-cdk-lib/assertions"
import {ManagedPolicy, PolicyStatement, Role} from "aws-cdk-lib/aws-iam"
import {LogGroup} from "aws-cdk-lib/aws-logs"
import {
  Architecture,
  Function as LambdaFunction,
  LayerVersion,
  Runtime
} from "aws-cdk-lib/aws-lambda"
import {resolve} from "node:path"
import {
  beforeAll,
  describe,
  expect,
  test
} from "vitest"

import {PythonLambdaFunction} from "../../src/constructs/PythonLambdaFunction"

describe("pythonFunctionConstruct works correctly", () => {
  let stack: Stack
  let app: App
  let template: assertions.Template
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lambdaLogGroupResource: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lambdaRoleResource: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lambdaResource: any

  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "pythonLambdaConstructStack")
    const functionConstruct = new PythonLambdaFunction(stack, "dummyPythonFunction", {
      functionName: "testPythonLambda",
      projectBaseDir: resolve(__dirname, "../../../.."),
      packageBasePath: "packages/cdkConstructs",
      handler: "index.handler",
      environmentVariables: {},
      logRetentionInDays: 30,
      logLevel: "INFO"
    })
    template = Template.fromStack(stack)
    const lambdaLogGroup = functionConstruct.node.tryFindChild("LambdaLogGroup") as LogGroup
    const lambdaRole = functionConstruct.node.tryFindChild("LambdaRole") as Role
    const cfnLambda = functionConstruct.node.tryFindChild("testPythonLambda") as LambdaFunction
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
      LogGroupName: "/aws/lambda/testPythonLambda",
      KmsKeyId: {"Fn::ImportValue": "account-resources:CloudwatchLogsKmsKeyArn"},
      RetentionInDays: 30
    })
  })

  test("it has the correct policy for writing logs", () => {
    template.hasResourceProperties("AWS::IAM::ManagedPolicy", {
      Description: "write to testPythonLambda logs",
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
      RoleArn: {"Fn::ImportValue": "lambda-resources:SplunkSubscriptionFilterRole"},
      DestinationArn: {"Fn::ImportValue": "lambda-resources:SplunkDeliveryStream"}
    })
  })

  test("it has the correct role", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: {Service: "lambda.amazonaws.com"}
        }]
      },
      ManagedPolicyArns: Match.arrayWith([
        {"Fn::ImportValue": "lambda-resources:LambdaInsightsLogGroupPolicy"},
        {"Fn::ImportValue": "account-resources:CloudwatchEncryptionKMSPolicyArn"}
      ])
    })
  })

  test("it has the correct lambda", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "index.handler",
      Runtime: "python3.14",
      FunctionName: "testPythonLambda",
      MemorySize: 256,
      Architectures: ["x86_64"],
      Timeout: 50,
      LoggingConfig: {
        LogGroup: lambdaLogGroupResource
      },
      Environment: {
        Variables: {
          POWERTOOLS_LOG_LEVEL: "INFO"
        }
      },
      Layers: ["arn:aws:lambda:eu-west-2:580247275435:layer:LambdaInsightsExtension:64"],
      Role: {"Fn::GetAtt": [lambdaRoleResource.Ref, "Arn"]}
    })
  })

  test("it has the correct policy for executing the lambda", () => {
    template.hasResourceProperties("AWS::IAM::ManagedPolicy", {
      Description: "execute lambda testPythonLambda",
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

describe("pythonFunctionConstruct works correctly with environment variables", () => {
  let stack: Stack
  let app: App
  let template: assertions.Template

  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "pythonLambdaConstructStack")
    new PythonLambdaFunction(stack, "dummyPythonFunction", {
      functionName: "testPythonLambda",
      projectBaseDir: resolve(__dirname, "../../../.."),
      packageBasePath: "packages/cdkConstructs",
      handler: "index.handler",
      environmentVariables: {foo: "bar"},
      logRetentionInDays: 30,
      logLevel: "DEBUG"
    })
    template = Template.fromStack(stack)
  })

  test("environment variables are added correctly", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "python3.14",
      FunctionName: "testPythonLambda",
      Environment: {Variables: {foo: "bar", POWERTOOLS_LOG_LEVEL: "DEBUG"}}
    })
  })
})

describe("pythonFunctionConstruct works correctly with additional policies", () => {
  let stack: Stack
  let app: App
  let template: assertions.Template
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let testPolicyResource: any

  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "pythonLambdaConstructStack")
    const testPolicy = new ManagedPolicy(stack, "testPolicy", {
      description: "test policy",
      statements: [
        new PolicyStatement({
          actions: ["logs:CreateLogStream"],
          resources: ["*"]
        })
      ]
    })
    new PythonLambdaFunction(stack, "dummyPythonFunction", {
      functionName: "testPythonLambda",
      projectBaseDir: resolve(__dirname, "../../../.."),
      packageBasePath: "packages/cdkConstructs",
      handler: "index.handler",
      environmentVariables: {},
      additionalPolicies: [testPolicy],
      logRetentionInDays: 30,
      logLevel: "INFO"
    })
    template = Template.fromStack(stack)
    testPolicyResource = stack.resolve(testPolicy.managedPolicyArn)
  })

  test("it has the correct policies in the role", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      ManagedPolicyArns: Match.arrayWith([
        {"Fn::ImportValue": "lambda-resources:LambdaInsightsLogGroupPolicy"},
        {"Fn::ImportValue": "account-resources:CloudwatchEncryptionKMSPolicyArn"},
        {Ref: testPolicyResource.Ref}
      ])
    })
  })
})

describe("pythonFunctionConstruct works correctly with additional layers", () => {
  let stack: Stack
  let app: App
  let template: assertions.Template

  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "pythonLambdaConstructStack")
    const parameterAndSecretsLayerArn =
      "arn:aws:lambda:eu-west-2:133256977650:layer:AWS-Parameters-and-Secrets-Lambda-Extension:20"
    const parameterAndSecretsLayer = LayerVersion.fromLayerVersionArn(
      stack, "AdditionalLayerFromArn", parameterAndSecretsLayerArn)
    new PythonLambdaFunction(stack, "dummyPythonFunction", {
      functionName: "testPythonLambda",
      projectBaseDir: resolve(__dirname, "../../../.."),
      packageBasePath: "packages/cdkConstructs",
      handler: "index.handler",
      environmentVariables: {},
      logRetentionInDays: 30,
      logLevel: "INFO",
      layers: [parameterAndSecretsLayer]
    })
    template = Template.fromStack(stack)
  })

  test("it has the correct layers added", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Layers: [
        "arn:aws:lambda:eu-west-2:580247275435:layer:LambdaInsightsExtension:64",
        "arn:aws:lambda:eu-west-2:133256977650:layer:AWS-Parameters-and-Secrets-Lambda-Extension:20"
      ]
    })
  })
})

describe("pythonFunctionConstruct works correctly with dependency layer", () => {
  let stack: Stack
  let app: App
  let template: assertions.Template

  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "pythonLambdaConstructStack")
    new PythonLambdaFunction(stack, "dummyPythonFunction", {
      functionName: "testPythonLambda",
      projectBaseDir: resolve(__dirname, "../../../.."),
      packageBasePath: "packages/cdkConstructs",
      dependencyLocation: "packages/cdkConstructs/tests/src",
      handler: "index.handler",
      environmentVariables: {},
      logRetentionInDays: 30,
      logLevel: "INFO"
    })
    template = Template.fromStack(stack)
  })

  test("it creates a lambda layer", () => {
    template.hasResourceProperties("AWS::Lambda::LayerVersion", {
      CompatibleArchitectures: ["x86_64"]
    })
  })

  test("it adds both insights and dependency layers", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Layers: Match.arrayWith([
        "arn:aws:lambda:eu-west-2:580247275435:layer:LambdaInsightsExtension:64",
        Match.objectLike({
          Ref: Match.stringLikeRegexp("DependencyLayer")
        })
      ])
    })
  })
})

describe("pythonFunctionConstruct works correctly with custom timeout", () => {
  let stack: Stack
  let app: App
  let template: assertions.Template

  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "pythonLambdaConstructStack")
    new PythonLambdaFunction(stack, "dummyPythonFunction", {
      functionName: "testPythonLambda",
      projectBaseDir: resolve(__dirname, "../../../.."),
      packageBasePath: "packages/cdkConstructs",
      handler: "index.handler",
      environmentVariables: {},
      logRetentionInDays: 30,
      logLevel: "INFO",
      timeoutInSeconds: 120
    })
    template = Template.fromStack(stack)
  })

  test("it has the correct timeout", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Timeout: 120
    })
  })
})

describe("pythonFunctionConstruct works correctly with different runtime", () => {
  let stack: Stack
  let app: App
  let template: assertions.Template

  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "pythonLambdaConstructStack")
    new PythonLambdaFunction(stack, "dummyPythonFunction", {
      functionName: "testPythonLambda",
      projectBaseDir: resolve(__dirname, "../../../.."),
      packageBasePath: "packages/cdkConstructs",
      handler: "index.handler",
      environmentVariables: {},
      logRetentionInDays: 30,
      logLevel: "INFO",
      runtime: Runtime.PYTHON_3_12
    })
    template = Template.fromStack(stack)
  })

  test("it has correct runtime", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "python3.12"
    })
  })
})

describe("pythonFunctionConstruct works correctly with different architecture", () => {
  let stack: Stack
  let app: App
  let template: assertions.Template

  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "pythonLambdaConstructStack")
    new PythonLambdaFunction(stack, "dummyPythonFunction", {
      functionName: "testPythonLambda",
      projectBaseDir: resolve(__dirname, "../../../.."),
      packageBasePath: "packages/cdkConstructs",
      handler: "index.handler",
      environmentVariables: {},
      logRetentionInDays: 30,
      logLevel: "INFO",
      architecture: Architecture.ARM_64
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
