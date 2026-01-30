import {Stack, CfnResource} from "aws-cdk-lib"
import {NagPackSuppression, NagSuppressions} from "cdk-nag"
import {IConstruct} from "constructs"

/**
 * Locate CloudFormation resources by their synthesized `aws:cdk:path` metadata.
 *
 * Use this helper when logical IDs vary between synths but the fully-qualified
 * construct path is stable (for example when targeting resources for nag
 * suppressions).
 *
 * @param construct - Root construct that will be walked recursively.
 * @param paths - One or more fully qualified `aws:cdk:path` strings to match.
 * @returns Every resource whose metadata path equals one of the supplied paths.
 */
export function findCloudFormationResourcesByPath(construct: IConstruct, paths: Array<string>): Array<CfnResource> {
  const matches: Array<CfnResource> = []
  const targetPaths = new Set(paths)
  const seen = new Set<string>()
  const search = (node: IConstruct): void => {
    if (node instanceof CfnResource) {
      const resourcePath = node.cfnOptions.metadata?.["aws:cdk:path"]
      if (typeof resourcePath === "string" && targetPaths.has(resourcePath) && !seen.has(node.logicalId)) {
        matches.push(node)
        seen.add(node.logicalId)
      }
    }
    for (const child of node.node.children) {
      search(child)
    }
  }
  search(construct)
  return matches
}

/**
 * Locate CloudFormation resources by CloudFormation type.
 *
 * Recursively traverses the construct tree and returns all `CfnResource`
 * instances that match the provided `AWS::<Service>::<Resource>` type string.
 *
 * @param construct - Root construct to traverse.
 * @param type - CloudFormation type identifier (for example `AWS::Lambda::Function`).
 * @returns All resources whose `cfnResourceType` matches `type`.
 */
export function findCloudFormationResourcesByType(construct: IConstruct, type: string): Array<CfnResource> {
  const matches: Array<CfnResource> = []
  const search = (node: IConstruct): void => {
    if (node instanceof CfnResource && node.cfnResourceType === type) {
      matches.push(node)
    }
    for (const child of node.node.children) {
      search(child)
    }
  }
  search(construct)
  return matches
}
/**
 * Merge cfn-guard rule suppressions onto the provided resources.
 *
 * Ensures the metadata structure exists, deduplicates rule IDs, and leaves any
 * pre-existing suppressions intact.
 *
 * @param resources - CloudFormation resources that require suppressions.
 * @param rules - One or more cfn-guard rule identifiers to suppress.
 */
export function addSuppressions(resources: Array<CfnResource>, rules: Array<string>): void {
  resources.forEach(resource => {
    if (!resource.cfnOptions.metadata) {
      resource.cfnOptions.metadata = {}
    }
    const existing = resource.cfnOptions.metadata.guard?.SuppressedRules || []
    const combined = Array.from(new Set([...existing, ...rules]))
    resource.cfnOptions.metadata.guard = {SuppressedRules: combined}
  })
}

/**
 * Apply the default lambda-focused cfn-guard suppressions.
 *
 * Finds every `AWS::Lambda::Function` in the stack and suppresses the common
 * Lambda guard rules related to DLQ usage, VPC placement, and reserved concurrency.
 *
 * @param stack - Stack containing the Lambda resources to update.
 */
export function addLambdaCfnGuardSuppressions(stack: Stack): void {
  const allLambdas = findCloudFormationResourcesByType(stack, "AWS::Lambda::Function")
  addSuppressions(allLambdas, ["LAMBDA_DLQ_CHECK", "LAMBDA_INSIDE_VPC", "LAMBDA_CONCURRENCY_CHECK"])
}

/**
 * Attach identical nag suppressions to several construct paths.
 *
 * Invokes `safeAddNagSuppression` for each path, allowing missing paths to be
 * skipped without failing the entire operation.
 *
 * @param stack - CDK stack that contains the constructs.
 * @param paths - Paths to apply the suppression group to.
 * @param suppressions - Suppression definitions shared by all targets.
 * The suppressions must include id and reason and can optionally include appliesTo.
 */
export function safeAddNagSuppressionGroup(
  stack: Stack,
  paths: Array<string>,
  suppressions: Array<NagPackSuppression>
) {
  paths.forEach(path => safeAddNagSuppression(stack, path, suppressions))
}

/**
 * Attach nag suppressions to a single construct path.
 *
 * Wraps `NagSuppressions.addResourceSuppressionsByPath` and logs an info-level
 * message when the path cannot be resolved, preventing build failures in
 * partially synthesized stacks.
 *
 * @param stack - CDK stack that contains the construct.
 * @param path - Fully qualified CDK path to the resource.
 * @param suppressions - Suppression entries to apply.
 */
export function safeAddNagSuppression(stack: Stack, path: string, suppressions: Array<NagPackSuppression>) {
  try {
    NagSuppressions.addResourceSuppressionsByPath(stack, path, suppressions)
  } catch (err) {
    console.log(`Could not find path ${path}: ${err}`)
  }
}
