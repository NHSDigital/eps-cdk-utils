
import {App, CfnResource, Stack} from "aws-cdk-lib"
import {IConstruct} from "constructs"
import {
  NagPack,
  NagPackProps,
  INagSuppressionIgnore,
  NagMessageLevel,
  NagRuleResult
} from "cdk-nag"
import {expect} from "vitest"

export enum TestType {
  NON_COMPLIANCE,
  COMPLIANCE,
  VALIDATION_FAILURE,
}
export function validateStack(stack: Stack, ruleId: string, type: TestType) {
  expect(ruleId).not.toEqual("")
  //const messages = SynthUtils.synthesize(stack).messages
  const synthedApp = App.of(stack)?.synth()
  const messages = synthedApp?.stacks[0].messages || []
  switch (type) {
    case TestType.COMPLIANCE:
      expect(messages).not.toContainEqual(
        expect.objectContaining({
          entry: expect.objectContaining({
            data: expect.stringMatching(`.*${ruleId}(\\[.*\\])?:`)
          })
        })
      )
      noValidationFailure()
      break
    case TestType.NON_COMPLIANCE:
      expect(messages).toContainEqual(
        expect.objectContaining({
          entry: expect.objectContaining({
            data: expect.stringContaining(`${ruleId}:`)
          })
        })
      )
      noValidationFailure()
      break
    case TestType.VALIDATION_FAILURE:
      expect(messages).toContainEqual(
        expect.objectContaining({
          entry: expect.objectContaining({
            data: expect.stringMatching(`.*CdkNagValidationFailure.*${ruleId}`)
          })
        })
      )
      break
  }

  function noValidationFailure() {
    expect(messages).not.toContainEqual(
      expect.objectContaining({
        entry: expect.objectContaining({
          data: expect.stringMatching(`.*CdkNagValidationFailure.*${ruleId}`)
        })
      })
    )
  }
}

export class TestPack extends NagPack {
  readonly rules: Array<(node: CfnResource) => NagRuleResult>
  readonly ruleSuffixOverride?: string
  readonly level?: NagMessageLevel
  constructor(
    rules: Array<(node: CfnResource) => NagRuleResult>,
    ignoreSuppressionCondition?: INagSuppressionIgnore,
    ruleSuffixOverride?: string,
    level?: NagMessageLevel,
    props?: NagPackProps
  ) {
    super(props)
    this.packName = "Test"
    this.rules = rules
    this.packGlobalSuppressionIgnore = ignoreSuppressionCondition
    this.ruleSuffixOverride = ruleSuffixOverride
    this.level = level
  }
  public visit(node: IConstruct): void {
    if (node instanceof CfnResource) {
      this.rules.forEach((rule) => {
        this.applyRule({
          ruleSuffixOverride: this.ruleSuffixOverride,
          info: "foo.",
          explanation: "bar.",
          level: this.level ?? NagMessageLevel.ERROR,
          rule: rule,
          node: node
        })
      })
    }
  }
}
