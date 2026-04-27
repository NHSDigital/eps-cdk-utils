import {App, Stack} from "aws-cdk-lib"
import {Template, Match} from "aws-cdk-lib/assertions"
import {
  describe,
  test,
  beforeAll,
  expect
} from "vitest"
import {Pass} from "aws-cdk-lib/aws-stepfunctions"

import {ExpressStateMachine} from "../../src/constructs/StateMachine.js"
import {CatchAllErrorPass} from "../../src/constructs/StateMachine/CatchAllErrorPass.js"

describe("ExpressStateMachine construct", () => {
  let stack: Stack
  let app: App
  let template: Template
  let construct: ExpressStateMachine

  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "StateMachineStack")

    const dummyState = new Pass(stack, "DummyState")

    construct = new ExpressStateMachine(stack, "TestStateMachine", {
      stackName: "test-stack",
      stateMachineName: "test-state-machine",
      definition: dummyState,
      logRetentionInDays: 30
    })

    template = Template.fromStack(stack)
  })

  test("creates CloudWatch log group with correct name and KMS key", () => {
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/stepfunctions/test-state-machine",
      KmsKeyId: {"Fn::ImportValue": "account-resources-cdk-uk:KMS:CloudwatchLogsKmsKey:Arn"},
      RetentionInDays: 30
    })
  })

  test("creates Splunk subscription filter by default", () => {
    template.hasResourceProperties("AWS::Logs::SubscriptionFilter", {
      FilterPattern: "",
      RoleArn: {"Fn::ImportValue": "account-resources-cdk-uk:IAM:SplunkSubscriptionFilterRole:Arn"}
    })
  })

  test("creates IAM role for state machine with correct service principal", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: [{
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: {Service: "states.amazonaws.com"}
        }]
      }
    })
  })

  test("creates Express state machine with tracing and logging", () => {
    template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
      StateMachineName: "test-state-machine",
      StateMachineType: "EXPRESS",
      TracingConfiguration: {Enabled: true},
      LoggingConfiguration: {
        IncludeExecutionData: true,
        Level: "ALL"
      }
    })
  })

  test("creates execution managed policy with StartSyncExecution permission", () => {
    template.hasResourceProperties("AWS::IAM::ManagedPolicy", {
      Description: "execute state machine test-state-machine",
      PolicyDocument: {
        Statement: [Match.objectLike({
          Action: Match.arrayWith(["states:StartSyncExecution", "states:StartExecution"]),
          Effect: "Allow"
        })]
      }
    })
  })

  test("creates put-logs managed policy allowing wildcard on log delivery actions", () => {
    template.hasResourceProperties("AWS::IAM::ManagedPolicy", {
      Description: "write to test-state-machine logs",
      PolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: Match.arrayWith(["logs:CreateLogStream", "logs:PutLogEvents"]),
            Effect: "Allow"
          }),
          Match.objectLike({
            Action: Match.arrayWith(["logs:DescribeLogGroups", "logs:CreateLogDelivery"]),
            Effect: "Allow",
            Resource: "*"
          })
        ]
      }
    })
  })

  test("exposes executionPolicy and stateMachine as public properties", () => {
    expect(construct.executionPolicy).toBeDefined()
    expect(construct.stateMachine).toBeDefined()
  })
})

describe("ExpressStateMachine with Splunk disabled", () => {
  let template: Template
  let construct: ExpressStateMachine

  beforeAll(() => {
    const app = new App()
    const stack = new Stack(app, "StateMachineNoSplunkStack")
    const dummyState = new Pass(stack, "DummyState")

    construct = new ExpressStateMachine(stack, "TestStateMachine", {
      stackName: "test-stack",
      stateMachineName: "test-state-machine",
      definition: dummyState,
      logRetentionInDays: 30,
      addSplunkSubscriptionFilter: false
    })

    template = Template.fromStack(stack)
  })

  test("does not create a subscription filter when addSplunkSubscriptionFilter is false", () => {
    const filters = template.findResources("AWS::Logs::SubscriptionFilter")
    expect(Object.keys(filters).length).toBe(0)
  })

  test("exposes executionPolicy and stateMachine as public properties", () => {
    expect(construct.executionPolicy).toBeDefined()
    expect(construct.stateMachine).toBeDefined()
  })
})

describe("CatchAllErrorPass construct", () => {
  let stack: Stack
  let template: Template
  let construct: CatchAllErrorPass

  beforeAll(() => {
    const app = new App()
    stack = new Stack(app, "CatchAllErrorStack")
    construct = new CatchAllErrorPass(stack, "TestCatchAllError")
    template = Template.fromStack(stack)
  })

  test("exposes a state property", () => {
    expect(construct.state).toBeDefined()
  })

  test("creates a Pass state in the stack", () => {
    template.resourceCountIs("AWS::StepFunctions::StateMachine", 0)
    // CatchAllErrorPass creates a Pass state; verify it is present as a construct child
    const passState = construct.node.tryFindChild("Catch All Error")
    expect(passState).toBeDefined()
  })
})
