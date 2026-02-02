import {
  App,
  Aspects,
  CfnResource,
  Stack
} from "aws-cdk-lib"
import {EpsNagPack} from "../../src/"
import {test, describe, expect} from "vitest"
import {IApplyRule, NagMessageLevel} from "cdk-nag"

describe("Check NagPack Details", () => {
  describe("EPSNagPack", () => {
    class EpsNagPackExtended extends EpsNagPack {
      actualWarnings = new Array<string>()
      actualErrors = new Array<string>()
      applyRule(params: IApplyRule): void {
        const ruleSuffix = params.ruleSuffixOverride
          ? params.ruleSuffixOverride
          : params.rule.name
        const ruleId = `${pack.readPackName}-${ruleSuffix}`
        if (params.level === NagMessageLevel.WARN) {
          this.actualWarnings.push(ruleId)
        } else {
          this.actualErrors.push(ruleId)
        }
      }
    }
    const pack = new EpsNagPackExtended()
    test("Pack Name is correct", () => {
      expect(pack.readPackName).toStrictEqual("EpsNagPack")
    })
    test("Pack contains expected warning and error rules", () => {
      const expectedWarnings = [] as Array<string>
      const expectedErrors = [
        "EpsNagPack-EPS1",
        "EpsNagPack-EPS2",
        "EpsNagPack-EPS3",
        "EpsNagPack-EPS4",
        "EpsNagPack-EPS5",
        "EpsNagPack-EPS6",
        "EpsNagPack-EPS7",
        "EpsNagPack-EPS8",
        "EpsNagPack-EPS9",
        "EpsNagPack-EPS10",
        "EpsNagPack-EPS11",
        "EpsNagPack-EPS12",
        "EpsNagPack-EPS13",
        "EpsNagPack-EPS14",
        "EpsNagPack-EPS15",
        "EpsNagPack-EPS16",
        "EpsNagPack-EPS17",
        "EpsNagPack-EPS18",
        "EpsNagPack-EPS19"
      ]
      const stack = new Stack()
      Aspects.of(stack).add(pack)
      new CfnResource(stack, "rTestResource", {type: "foo"})
      App.of(stack)?.synth()
      expect(pack.actualWarnings.sort()).toEqual(expectedWarnings.sort())
      expect(pack.actualErrors.sort()).toEqual(expectedErrors.sort())
    })
  })
})
