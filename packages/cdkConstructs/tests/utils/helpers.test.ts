import {
  afterEach,
  describe,
  expect,
  test,
  vi
} from "vitest"
import {Stack, CfnResource} from "aws-cdk-lib"
import {Code, Function as LambdaFunction, Runtime} from "aws-cdk-lib/aws-lambda"
import {NagPackSuppression, NagSuppressions} from "cdk-nag"

import * as helpers from "../../src/utils/helpers"

const defaultSuppressionRules = ["LAMBDA_DLQ_CHECK", "LAMBDA_INSIDE_VPC", "LAMBDA_CONCURRENCY_CHECK"]

const createResource = (stack: Stack, id: string, type = "Custom::Test", path?: string): CfnResource => {
  const resource = new CfnResource(stack, id, {type, properties: {}})
  resource.cfnOptions.metadata = {
    ...(resource.cfnOptions.metadata ?? {}),
    "aws:cdk:path": path ?? `${stack.stackName}/${id}`
  }
  return resource
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("findCloudFormationResourcesByPath", () => {
  test("returns unique matches for the provided metadata paths", () => {
    const stack = new Stack(undefined, "HelpersTestStack")
    const first = createResource(stack, "First", "Custom::Foo", "match/one")
    const second = createResource(stack, "Second", "Custom::Foo", "match/two")
    createResource(stack, "Third", "Custom::Foo", "nope")

    const matches = helpers.findCloudFormationResourcesByPath(stack, ["match/one", "match/one", "match/two"])

    expect(matches).toEqual([first, second])
  })
})

describe("findCloudFormationResourcesByType", () => {
  test("returns every resource whose CloudFormation type matches", () => {
    const stack = new Stack(undefined, "HelpersTestStack")
    const fooOne = createResource(stack, "FooOne", "Custom::Foo")
    const fooTwo = createResource(stack, "FooTwo", "Custom::Foo")
    createResource(stack, "Bar", "Custom::Bar")

    const matches = helpers.findCloudFormationResourcesByType(stack, "Custom::Foo")

    expect(matches).toEqual([fooOne, fooTwo])
  })
})

describe("addSuppressions", () => {
  test("merges new rules, deduplicates them, and creates metadata when missing", () => {
    const stack = new Stack(undefined, "HelpersTestStack")
    const existing = createResource(stack, "Existing")
    existing.cfnOptions.metadata = {
      ...existing.cfnOptions.metadata,
      guard: {SuppressedRules: ["EXISTING", "SHARED"]}
    }
    const empty = createResource(stack, "Empty")

    helpers.addSuppressions([existing, empty], ["SHARED", "NEW"])

    expect(existing.cfnOptions.metadata?.guard?.SuppressedRules).toEqual(["EXISTING", "SHARED", "NEW"])
    expect(empty.cfnOptions.metadata?.guard?.SuppressedRules).toEqual(["SHARED", "NEW"])
  })
})

describe("addLambdaCfnGuardSuppressions", () => {
  test("applies the default lambda suppressions to every lambda in the stack", () => {
    const stack = new Stack(undefined, "HelpersTestStack")
    const lambdaOne = new LambdaFunction(stack, "LambdaOne", {
      runtime: Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: Code.fromInline("exports.handler = async () => {};")
    })
    const lambdaTwo = new LambdaFunction(stack, "LambdaTwo", {
      runtime: Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: Code.fromInline("exports.handler = async () => {};")
    })

    helpers.addLambdaCfnGuardSuppressions(stack)

    const firstCfn = lambdaOne.node.defaultChild as CfnResource
    const secondCfn = lambdaTwo.node.defaultChild as CfnResource
    expect(firstCfn.cfnOptions.metadata?.guard?.SuppressedRules).toEqual(defaultSuppressionRules)
    expect(secondCfn.cfnOptions.metadata?.guard?.SuppressedRules).toEqual(defaultSuppressionRules)
  })
})

describe("safeAddNagSuppressionGroup", () => {
  test("invokes cdk-nag for every provided path", () => {
    const stack = new Stack(undefined, "HelpersTestStack")
    const suppressions: Array<NagPackSuppression> = [{id: "RULE", reason: "already covered"}]
    const spy = vi.spyOn(NagSuppressions, "addResourceSuppressionsByPath").mockImplementation(() => {})

    helpers.safeAddNagSuppressionGroup(stack, ["one", "two"], suppressions)

    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenNthCalledWith(1, stack, "one", suppressions)
    expect(spy).toHaveBeenNthCalledWith(2, stack, "two", suppressions)
  })
})

describe("safeAddNagSuppression", () => {
  const sampleSuppressions: Array<NagPackSuppression> = [{id: "RULE", reason: "covered elsewhere"}]

  test("routes suppressions to cdk-nag", () => {
    const stack = new Stack(undefined, "HelpersTestStack")
    const spy = vi.spyOn(NagSuppressions, "addResourceSuppressionsByPath").mockImplementation(() => {})

    helpers.safeAddNagSuppression(stack, "path/to/resource", sampleSuppressions)

    expect(spy).toHaveBeenCalledWith(stack, "path/to/resource", sampleSuppressions)
  })

  test("logs and swallows errors when the target path cannot be resolved", () => {
    const stack = new Stack(undefined, "HelpersTestStack")
    vi.spyOn(NagSuppressions, "addResourceSuppressionsByPath").mockImplementation(() => {
      throw new Error("missing")
    })
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    expect(() => helpers.safeAddNagSuppression(stack, "missing/path", sampleSuppressions)).not.toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("missing/path"))
  })
})
