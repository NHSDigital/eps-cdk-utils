import {Aspects, Stack} from "aws-cdk-lib"
import {beforeEach, test} from "vitest"
import {TestPack, TestType, validateStack} from "./utils"
import {ApiGWMutualTls} from "../../src/nag/rules"
import {describe} from "node:test"
import {CfnDomainName} from "aws-cdk-lib/aws-apigateway"

const testPack = new TestPack([
  ApiGWMutualTls
])
let stack: Stack
beforeEach(() => {
  stack = new Stack()
  Aspects.of(stack).add(testPack)
})

describe("ApiGWMutualTls", () => {
  const ruleId = "ApiGWMutualTls"
  test("Non-compliant when mutual TLS is not enabled", () => {
    new CfnDomainName(stack, "TestDomain", {
      domainName: "test.example.com",
      securityPolicy: "SecurityPolicy_TLS13_1_3_2025_09 "
    })

    // Validate
    validateStack(stack, ruleId, TestType.NON_COMPLIANCE)
  })
  test("Compliant when mutual TLS is enabled", () => {
    new CfnDomainName(stack, "TestDomain", {
      domainName: "test.example.com",
      securityPolicy: "SecurityPolicy_TLS13_1_3_2025_09 ",
      mutualTlsAuthentication: {
        truststoreUri: "truststoreUri",
        truststoreVersion: "truststoreVersion"
      }
    })

    // Validate
    validateStack(stack, ruleId, TestType.COMPLIANCE)
  })

  test("Non-compliant when mutual TLS is missing trustStoreVersion", () => {
    new CfnDomainName(stack, "TestDomain", {
      domainName: "test.example.com",
      securityPolicy: "SecurityPolicy_TLS13_1_3_2025_09 ",
      mutualTlsAuthentication: {
        truststoreUri: "truststoreUri"
      }
    })

    // Validate
    validateStack(stack, ruleId, TestType.NON_COMPLIANCE)
  })
  test("Compliant when mutual TLS is not enabled in a pull request", () => {
    stack.node.setContext("isPullRequest", true)
    new CfnDomainName(stack, "TestDomain", {
      domainName: "test.example.com",
      securityPolicy: "SecurityPolicy_TLS13_1_3_2025_09 "
    })

    // Validate
    validateStack(stack, ruleId, TestType.COMPLIANCE)
  })
  test("Compliant when mutual TLS is not enabled in not a pull request", () => {
    stack.node.setContext("isPullRequest", false)
    new CfnDomainName(stack, "TestDomain", {
      domainName: "test.example.com",
      securityPolicy: "SecurityPolicy_TLS13_1_3_2025_09 "
    })

    // Validate
    validateStack(stack, ruleId, TestType.NON_COMPLIANCE)
  })

})
