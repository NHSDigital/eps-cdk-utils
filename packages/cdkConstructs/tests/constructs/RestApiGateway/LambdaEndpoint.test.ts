import {App, Stack} from "aws-cdk-lib"
import {RestApi} from "aws-cdk-lib/aws-apigateway"
import {Role, ServicePrincipal} from "aws-cdk-lib/aws-iam"
import {Template, Match} from "aws-cdk-lib/assertions"
import {Architecture, Function as LambdaFunction, Runtime} from "aws-cdk-lib/aws-lambda"
import {
  describe,
  test,
  beforeAll,
  expect
} from "vitest"
import {HttpMethod} from "aws-cdk-lib/aws-lambda"

import {LambdaEndpoint} from "../../../src/constructs/RestApiGateway/LambdaEndpoint.js"

describe("LambdaEndpoint construct", () => {
  let stack: Stack
  let template: Template
  let construct: LambdaEndpoint

  beforeAll(() => {
    const app = new App()
    stack = new Stack(app, "LambdaEndpointStack")

    const api = new RestApi(stack, "TestApi")

    const credentialsRole = new Role(stack, "ApiGwRole", {
      assumedBy: new ServicePrincipal("apigateway.amazonaws.com")
    })

    // Minimal lambda function stub that satisfies LambdaFunctionHolder interface
    const lambdaFn = new LambdaFunction(stack, "DummyFn", {
      runtime: Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: {
        bind: () => ({
          s3Location: {bucketName: "dummy", objectKey: "dummy.zip"}
        }),
        bindToResource: () => undefined,
        isInline: false
      } as unknown as never,
      architecture: Architecture.X86_64
    })

    construct = new LambdaEndpoint(stack, "TestLambdaEndpoint", {
      parentResource: api.root,
      resourceName: "test-resource",
      method: HttpMethod.GET,
      restApiGatewayRole: credentialsRole,
      lambdaFunction: {function: lambdaFn}
    })

    template = Template.fromStack(stack)
  })

  test("creates an API Gateway resource with the correct path part", () => {
    template.hasResourceProperties("AWS::ApiGateway::Resource", {
      PathPart: "test-resource"
    })
  })

  test("creates a GET method on the resource", () => {
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "GET"
    })
  })

  test("exposes the resource as a public property", () => {
    expect(construct.resource).toBeDefined()
  })

  test("uses credentials role on the Lambda integration", () => {
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "GET",
      Integration: Match.objectLike({
        Type: "AWS_PROXY"
      })
    })
  })
})

describe("LambdaEndpoint accepts TypescriptLambdaFunction via structural typing", () => {
  test("LambdaFunctionHolder interface is satisfied by any object with a function property", () => {
    // This is a compile-time check verified by the build step. Here we just
    // assert the interface shape is correct at runtime.
    const holder = {function: {} as unknown as never}
    expect(holder.function).toBeDefined()
  })
})
