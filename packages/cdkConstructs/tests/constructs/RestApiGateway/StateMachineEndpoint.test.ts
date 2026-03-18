import {App, Stack} from "aws-cdk-lib"
import {RestApi} from "aws-cdk-lib/aws-apigateway"
import {Role, ServicePrincipal} from "aws-cdk-lib/aws-iam"
import {Template, Match} from "aws-cdk-lib/assertions"
import {
  describe,
  test,
  beforeAll,
  expect
} from "vitest"
import {HttpMethod} from "aws-cdk-lib/aws-lambda"
import {Pass} from "aws-cdk-lib/aws-stepfunctions"

import {StateMachineEndpoint} from "../../../src/constructs/RestApiGateway/StateMachineEndpoint.js"
import {ExpressStateMachine} from "../../../src/constructs/StateMachine.js"
import {stateMachineRequestTemplate} from "../../../src/constructs/RestApiGateway/templates/stateMachineRequest.js"
import {
  stateMachine200ResponseTemplate,
  stateMachineErrorResponseTemplate
} from "../../../src/constructs/RestApiGateway/templates/stateMachineResponses.js"

describe("StateMachineEndpoint construct", () => {
  let stack: Stack
  let template: Template
  let construct: StateMachineEndpoint

  beforeAll(() => {
    const app = new App()
    stack = new Stack(app, "StateMachineEndpointStack")

    const api = new RestApi(stack, "TestApi")

    const credentialsRole = new Role(stack, "ApiGwRole", {
      assumedBy: new ServicePrincipal("apigateway.amazonaws.com")
    })

    const dummyState = new Pass(stack, "DummyState")
    const expressStateMachine = new ExpressStateMachine(stack, "TestStateMachine", {
      stackName: "test-stack",
      stateMachineName: "test-state-machine",
      definition: dummyState,
      logRetentionInDays: 30
    })

    construct = new StateMachineEndpoint(stack, "TestStateMachineEndpoint", {
      parentResource: api.root,
      resourceName: "clinical-view",
      method: HttpMethod.GET,
      restApiGatewayRole: credentialsRole,
      stateMachine: expressStateMachine
    })

    template = Template.fromStack(stack)
  })

  test("creates an API Gateway resource with the correct path part", () => {
    template.hasResourceProperties("AWS::ApiGateway::Resource", {
      PathPart: "clinical-view"
    })
  })

  test("creates a GET method on the resource", () => {
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "GET"
    })
  })

  test("uses Step Functions integration with correct integration responses", () => {
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      Integration: Match.objectLike({
        Type: "AWS",
        IntegrationHttpMethod: "POST",
        IntegrationResponses: Match.arrayWith([
          Match.objectLike({StatusCode: "200"}),
          Match.objectLike({StatusCode: "400", SelectionPattern: "^4\\d{2}.*"}),
          Match.objectLike({StatusCode: "500", SelectionPattern: "^5\\d{2}.*"})
        ])
      })
    })
  })

  test("exposes the resource as a public property", () => {
    expect(construct.resource).toBeDefined()
  })
})

describe("stateMachineRequestTemplate helper", () => {
  test("returns a string containing the provided ARN", () => {
    const arn = "arn:aws:states:eu-west-2:123456789012:stateMachine:test"
    const result = stateMachineRequestTemplate(arn)
    expect(result).toContain(arn)
    expect(result).toContain("stateMachineArn")
  })

  test("includes header, queryString, and path parameter blocks", () => {
    const result = stateMachineRequestTemplate("arn:test")
    expect(result).toContain("includeHeaders")
    expect(result).toContain("includeQueryString")
    expect(result).toContain("includePath")
  })
})

describe("stateMachineResponseTemplates helpers", () => {
  test("200 template references Payload.statusCode", () => {
    expect(stateMachine200ResponseTemplate).toContain("Payload.statusCode")
    expect(stateMachine200ResponseTemplate).toContain("Payload.body")
  })

  test("error template for 400 includes BAD_REQUEST coding", () => {
    const result = stateMachineErrorResponseTemplate("400")
    expect(result).toContain("BAD_REQUEST")
    expect(result).toContain("application/fhir+json")
  })

  test("error template for 500 includes SERVER_ERROR coding", () => {
    const result = stateMachineErrorResponseTemplate("500")
    expect(result).toContain("SERVER_ERROR")
  })
})
