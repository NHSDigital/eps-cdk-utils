
/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
Modifications copyright (c) 2026 NHS Digital – see THIRD_PARTY_NOTICES.md
*/
import {parse} from "path"
import {CfnResource, Stack} from "aws-cdk-lib"
import {CfnDeployment, CfnStage} from "aws-cdk-lib/aws-apigateway"
import {CfnStage as CfnStageV2} from "aws-cdk-lib/aws-apigatewayv2"
import {CfnApi, CfnHttpApi} from "aws-cdk-lib/aws-sam"
import {NagRuleCompliance} from "cdk-nag"

// Copied from https://github.com/cdklabs/cdk-nag/blob/main/src/rules/apigw/APIGWStructuredLogging.ts
// with minor adjustments to handle CfnDeployment access log settings possibly being undefined
// see https://github.com/cdklabs/cdk-nag/issues/2267
// and https://github.com/cdklabs/cdk-nag/pull/2268

const isJSON = (str: string) => {
  try {
    JSON.parse(str)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    return false
  }
  return true
}

/**
 * API Gateway logs are configured in JSON format.
 * @param node the CfnResource to check
 */
export default Object.defineProperty(
  (node: CfnResource): NagRuleCompliance => {
    if (
      node instanceof CfnApi ||
      node instanceof CfnHttpApi ||
      node instanceof CfnStage
    ) {
      const accessLogSetting = Stack.of(node).resolve(node.accessLogSetting)
      if (!accessLogSetting ) {
        return NagRuleCompliance.NOT_APPLICABLE
      }
      if (isJSON(accessLogSetting.format)) {
        return NagRuleCompliance.COMPLIANT
      }
      return NagRuleCompliance.NON_COMPLIANT
    } else if (node instanceof CfnDeployment) {
      const stageDescription = Stack.of(node).resolve(node.stageDescription)
      const accessLogSetting = stageDescription?.accessLogSetting
      if (!accessLogSetting) {
        return NagRuleCompliance.NOT_APPLICABLE
      }
      if (isJSON(accessLogSetting.format)) {
        return NagRuleCompliance.COMPLIANT
      }
      return NagRuleCompliance.NON_COMPLIANT
    } else if (node instanceof CfnStageV2) {
      const accessLogSetting = Stack.of(node).resolve(node.accessLogSettings)
      if (!accessLogSetting) {
        return NagRuleCompliance.NOT_APPLICABLE
      }
      if (isJSON(accessLogSetting.format)) {
        return NagRuleCompliance.COMPLIANT
      }
      return NagRuleCompliance.NON_COMPLIANT
    }
    return NagRuleCompliance.NOT_APPLICABLE

  },
  "name",
  {value: parse(__filename).name}
)
