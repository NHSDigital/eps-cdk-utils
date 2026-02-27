/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
Modifications copyright (c) 2026 NHS Digital – see THIRD_PARTY_NOTICES.md
*/
import {Aspects, Stack} from "aws-cdk-lib"
import {beforeEach, test} from "vitest"
import {TestPack, TestType, validateStack} from "./utils"
import {APIGWStructuredLogging} from "../../src/nag/rules"
import {describe} from "node:test"
import {CfnDeployment, CfnStage} from "aws-cdk-lib/aws-apigateway"
import {CfnApi, CfnHttpApi} from "aws-cdk-lib/aws-sam"
import {CfnStage as CfnV2Stage} from "aws-cdk-lib/aws-apigatewayv2"

// Copied from https://github.com/cdklabs/cdk-nag/blob/main/test/rules/APIGW.test.ts
// with minor adjustments to handle CfnDeployment access log settings possibly being undefined
// only copied relevant tests for structured logging
// see https://github.com/cdklabs/cdk-nag/issues/2267
// and https://github.com/cdklabs/cdk-nag/pull/2268

const testPack = new TestPack([
  APIGWStructuredLogging
])
let stack: Stack
beforeEach(() => {
  stack = new Stack()
  Aspects.of(stack).add(testPack)
})

describe("APIGWStructuredLogging: API Gateway stages use JSON-formatted structured logging", () => {
  const ruleId = "APIGWStructuredLogging"

  test("Noncompliance 1: Non-JSON format (CfnStage)", () => {
    new CfnStage(stack, "RestApiStageNonJsonFormat", {
      restApiId: "foo",
      stageName: "prod",
      accessLogSetting: {
        destinationArn:
            "arn:aws:logs:us-east-1:123456789012:log-group:API-Gateway-Execution-Logs_abc123/prod",
        format:
            // eslint-disable-next-line max-len
            '$context.identity.sourceIp $context.identity.caller $context.identity.user [$context.requestTime] "$context.httpMethod $context.resourcePath $context.protocol" $context.status $context.responseLength $context.requestId'
      }
    })
    validateStack(stack, ruleId, TestType.NON_COMPLIANCE)
  })

  test("Noncompliance 2: No access log settings (CfnDeployment)", () => {
    new CfnDeployment(stack, "RestApiDeploymentNoLogs", {
      restApiId: "foo",
      stageDescription: {
        accessLogSetting: {
          destinationArn:
              "arn:aws:logs:us-east-1:123456789012:log-group:API-Gateway-Execution-Logs_abc123/prod"
        }
      }
    })
    validateStack(stack, ruleId, TestType.NON_COMPLIANCE)
  })

  test("Noncompliance 3: No access log settings (CfnApi)", () => {
    new CfnApi(stack, "SamApiNoLogs", {
      stageName: "MyApi",
      accessLogSetting: {
        destinationArn:
            "arn:aws:logs:us-east-1:123456789012:log-group:API-Gateway-Execution-Logs_abc123/prod"
      }
    })
    validateStack(stack, ruleId, TestType.NON_COMPLIANCE)
  })

  test("Noncompliance 4: No access log settings (CfnHttpApi)", () => {
    new CfnHttpApi(stack, "SamHttpApiNoLogs", {
      stageName: "MyApi",
      accessLogSetting: {
        destinationArn:
            "arn:aws:logs:us-east-1:123456789012:log-group:API-Gateway-Execution-Logs_abc123/prod"
      }
    })
    validateStack(stack, ruleId, TestType.NON_COMPLIANCE)
  })

  test("Compliance 1: JSON-formatted log (CfnStage)", () => {
    new CfnStage(stack, "RestApiStageJsonFormat", {
      restApiId: "foo",
      stageName: "prod",
      accessLogSetting: {
        destinationArn:
            "arn:aws:logs:us-east-1:123456789012:log-group:API-Gateway-Execution-Logs_abc123/prod",
        format:
            // eslint-disable-next-line max-len
            '{"requestId":"$context.requestId", "ip": "$context.identity.sourceIp", "caller":"$context.identity.caller", "user":"$context.identity.user","requestTime":"$context.requestTime", "httpMethod":"$context.httpMethod","resourcePath":"$context.resourcePath", "status":"$context.status","protocol":"$context.protocol", "responseLength":"$context.responseLength"}'
      }
    })
    validateStack(stack, ruleId, TestType.COMPLIANCE)
  })

  test("Compliance 2: HTTP API with JSON-formatted log (CfnStageV2)", () => {
    new CfnV2Stage(stack, "HttpApiStageJsonFormat", {
      apiId: "bar",
      stageName: "prod",
      accessLogSettings: {
        destinationArn:
            "arn:aws:logs:us-east-1:123456789012:log-group:API-Gateway-Execution-Logs_abc123/prod",
        format:
            // eslint-disable-next-line max-len
            '{"requestId":"$context.requestId", "ip": "$context.identity.sourceIp", "requestTime":"$context.requestTime", "httpMethod":"$context.httpMethod","routeKey":"$context.routeKey", "status":"$context.status","protocol":"$context.protocol", "responseLength":"$context.responseLength"}'
      }
    })
    validateStack(stack, ruleId, TestType.COMPLIANCE)
  })

  test("Compliance 3: JSON-formatted log (CfnDeployment)", () => {
    new CfnDeployment(stack, "RestApiDeploymentJsonFormat", {
      restApiId: "foo",
      stageDescription: {
        accessLogSetting: {
          destinationArn:
              "arn:aws:logs:us-east-1:123456789012:log-group:API-Gateway-Execution-Logs_abc123/prod",
          format:
              // eslint-disable-next-line max-len
              '{"requestId":"$context.requestId", "ip": "$context.identity.sourceIp", "caller":"$context.identity.caller", "user":"$context.identity.user","requestTime":"$context.requestTime", "httpMethod":"$context.httpMethod","resourcePath":"$context.resourcePath", "status":"$context.status","protocol":"$context.protocol", "responseLength":"$context.responseLength"}'
        }
      }
    })
    validateStack(stack, ruleId, TestType.COMPLIANCE)
  })

  test("Compliance 4: JSON-formatted log (CfnApi)", () => {
    new CfnApi(stack, "SamApiJsonFormat", {
      stageName: "MyApi",
      accessLogSetting: {
        destinationArn:
            "arn:aws:logs:us-east-1:123456789012:log-group:API-Gateway-Execution-Logs_abc123/prod",
        format:
            // eslint-disable-next-line max-len
            '{"requestId":"$context.requestId", "ip": "$context.identity.sourceIp", "caller":"$context.identity.caller", "user":"$context.identity.user","requestTime":"$context.requestTime", "httpMethod":"$context.httpMethod","resourcePath":"$context.resourcePath", "status":"$context.status","protocol":"$context.protocol", "responseLength":"$context.responseLength"}'
      }
    })
    validateStack(stack, ruleId, TestType.COMPLIANCE)
  })

  test("Compliance 5: JSON-formatted log (CfnHttpApi)", () => {
    new CfnHttpApi(stack, "SamHttpApiJsonFormat", {
      stageName: "MyApi",
      accessLogSetting: {
        destinationArn:
            "arn:aws:logs:us-east-1:123456789012:log-group:API-Gateway-Execution-Logs_abc123/prod",
        format:
            // eslint-disable-next-line max-len
            '{"requestId":"$context.requestId", "ip": "$context.identity.sourceIp", "requestTime":"$context.requestTime", "httpMethod":"$context.httpMethod","routeKey":"$context.routeKey", "status":"$context.status","protocol":"$context.protocol", "responseLength":"$context.responseLength"}'
      }
    })
    validateStack(stack, ruleId, TestType.COMPLIANCE)
  })

  test("Compliance 6: No stageDescription (CfnDeployment)", () => {
    new CfnDeployment(stack, "RestApiDeploymentNoStageDescription", {
      restApiId: "foo"
    })
    validateStack(stack, ruleId, TestType.COMPLIANCE)
  })
})
