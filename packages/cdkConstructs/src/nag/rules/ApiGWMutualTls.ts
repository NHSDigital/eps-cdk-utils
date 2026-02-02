import {parse} from "node:path"
import {CfnResource, Stack} from "aws-cdk-lib"
import {CfnDomainName} from "aws-cdk-lib/aws-apigateway"
import {NagRules, NagRuleCompliance} from "cdk-nag"
/**
 * APIs gateway have mutual TLS enabled unless this is a pull request
 * @param node the CfnResource to check
 */
export default Object.defineProperty(
  (node: CfnResource): NagRuleCompliance => {
    if (node instanceof CfnDomainName) {
      const stack = Stack.of(node)
      // Try getting isPullRequest context value
      const isPullRequest = stack.node.tryGetContext("isPullRequest") === true

      if (isPullRequest) {
        return NagRuleCompliance.COMPLIANT
      }

      const mutualTls = node.mutualTlsAuthentication
      if (mutualTls === undefined) {
        return NagRuleCompliance.NON_COMPLIANT
      }

      const trustStoreUri = NagRules.resolveIfPrimitive(
        node,
        (mutualTls as CfnDomainName.MutualTlsAuthenticationProperty)
          .truststoreUri
      )

      const trustStoreVersion = NagRules.resolveIfPrimitive(
        node,
        (mutualTls as CfnDomainName.MutualTlsAuthenticationProperty)
          .truststoreVersion
      )

      if (trustStoreUri === undefined || trustStoreVersion === undefined) {
        return NagRuleCompliance.NON_COMPLIANT
      }

      return NagRuleCompliance.COMPLIANT
    }

    return NagRuleCompliance.NOT_APPLICABLE
  },
  "name",
  {value: parse(__filename).name}
)
