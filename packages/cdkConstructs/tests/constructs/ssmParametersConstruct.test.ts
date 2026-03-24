import {App, Stack} from "aws-cdk-lib"
import {Template} from "aws-cdk-lib/assertions"
import {
  beforeAll,
  describe,
  expect,
  test
} from "vitest"

import {SsmParametersConstruct} from "../../src/constructs/SsmParametersConstruct"
import {assert} from "node:console"

describe("SsmParametersConstruct", () => {
  let template: Template

  beforeAll(() => {
    const app = new App()
    const stack = new Stack(app, "parameterStack")

    const params = new SsmParametersConstruct(stack, "TestingParameters", {
      stackName: "mock-stack",
      parameters: [
        {
          id: "MockParam1",
          nameSuffix: "MockParam1",
          description: "Description for mock parameter 1",
          value: "mock-value-1",
          outputExportSuffix: "MockParam1Parameter",
          outputDescription: "Name of the SSM parameter holding MockParam1"
        },
        {
          id: "MockParam2",
          nameSuffix: "MockParam2",
          description: "Description for mock parameter 2",
          value: "mock-value-2",
          outputExportSuffix: "MockParam2Parameter",
          outputDescription: "Name of the SSM parameter holding MockParam2"
        },
        {
          id: "MockParam3",
          nameSuffix: "MockParam3",
          description: "Description for mock parameter 3",
          value: "mock-value-3",
          outputExportSuffix: "MockParam3Parameter",
          outputDescription: "Name of the SSM parameter holding MockParam3"
        }
      ],
      readPolicyDescription: "Mock policy description",
      readPolicyOutputDescription: "Mock read policy output description",
      readPolicyExportSuffix: "MockGetParametersPolicy"
    })
    // Sonarcloud complains that the construct is not used, so we add an assertion to sidestep that.
    assert(params, "SsmParametersConstruct should be created successfully")

    template = Template.fromStack(stack)
  })

  test("creates all SSM parameters", () => {
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "mock-stack-MockParam1",
      Type: "String",
      Value: "mock-value-1"
    })

    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "mock-stack-MockParam2",
      Type: "String",
      Value: "mock-value-2"
    })

    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "mock-stack-MockParam3",
      Type: "String",
      Value: "mock-value-3"
    })
  })

  test("creates read policy with GetParameter actions for all parameters", () => {
    const policies = template.findResources("AWS::IAM::ManagedPolicy", {
      Properties: {
        Description: "Mock policy description"
      }
    })

    expect(Object.keys(policies)).toHaveLength(1)

    const policy = Object.values(policies)[0] as {
      Properties: {
        PolicyDocument: {
          Statement: Array<{
            Action: Array<string>
            Resource: Array<unknown>
          }>
        }
      }
    }

    const statement = policy.Properties.PolicyDocument.Statement[0]
    expect(statement.Action).toEqual(["ssm:GetParameter", "ssm:GetParameters"])
    expect(statement.Resource).toHaveLength(3)
  })

  test("exports parameter names and policy ARN", () => {
    const outputs = template.toJSON().Outputs as Record<string, {
      Description?: string
      Export?: {
        Name?: string
      }
    }>

    const exportedNames = Object.values(outputs)
      .map((output) => output.Export?.Name)
      .filter((name): name is string => name !== undefined)

    const descriptions = Object.values(outputs)
      .map((output) => output.Description)
      .filter((description): description is string => description !== undefined)

    expect(exportedNames).toContain("mock-stack-MockParam1Parameter")
    expect(exportedNames).toContain("mock-stack-MockParam2Parameter")
    expect(exportedNames).toContain("mock-stack-MockParam3Parameter")
    expect(exportedNames).toContain("mock-stack-MockGetParametersPolicy")

    expect(descriptions).toContain("Name of the SSM parameter holding MockParam1")
    expect(descriptions).toContain("Name of the SSM parameter holding MockParam2")
    expect(descriptions).toContain("Name of the SSM parameter holding MockParam3")
    expect(descriptions).toContain("Mock read policy output description")
  })
})
