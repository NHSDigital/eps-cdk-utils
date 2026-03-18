import {
  CloudFormationClient,
  DescribeChangeSetCommand,
  DescribeChangeSetCommandOutput,
  Change as CloudFormationChange
} from "@aws-sdk/client-cloudformation"

const normalizeToString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined
  }

  return String(value)
}

const isDestructiveChange = (
  policyAction: string | undefined,
  action: string | undefined,
  replacement: string | undefined
): boolean => {
  return policyAction === "Delete" ||
    policyAction === "ReplaceAndDelete" ||
    action === "Remove" ||
    replacement === "True"
}

export type ChangeRequiringAttention = {
  logicalId: string;
  physicalId: string;
  resourceType: string;
  policyAction: string;
  action: string;
  replacement: string;
}

export type AllowedDestructiveChange = {
  LogicalResourceId: string;
  PhysicalResourceId: string;
  ResourceType: string;
  PolicyAction?: string | null;
  Action?: string | null;
  Replacement?: string | null;
  ExpiryDate: string | Date;
  StackName: string;
  AllowedReason: string;
}

const toDate = (value: Date | string | number | undefined | null): Date | undefined => {
  if (value === undefined || value === null) {
    return undefined
  }

  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/**
 * Extracts the subset of CloudFormation changes that either require replacement or remove resources.
 *
 * @param changeSet - Raw change-set details returned from `DescribeChangeSet`.
 * @returns Array of changes that need operator attention.
 */
export function checkDestructiveChanges(
  changeSet: DescribeChangeSetCommandOutput | undefined | null
): Array<ChangeRequiringAttention> {
  if (!changeSet || typeof changeSet !== "object") {
    throw new Error("A change set object must be provided")
  }

  const {Changes} = changeSet
  const changes = Array.isArray(Changes) ? (Changes as Array<CloudFormationChange>) : []

  return changes
    .map((change: CloudFormationChange) => {
      const resourceChange = change?.ResourceChange
      if (!resourceChange) {
        return undefined
      }

      const policyAction = normalizeToString(resourceChange.PolicyAction)
      const action = normalizeToString(resourceChange.Action)
      const replacement = normalizeToString(resourceChange.Replacement)

      if (!isDestructiveChange(policyAction, action, replacement)) {
        return undefined
      }

      return {
        logicalId: resourceChange.LogicalResourceId ?? "<unknown logical id>",
        physicalId: resourceChange.PhysicalResourceId ?? "<unknown physical id>",
        resourceType: resourceChange.ResourceType ?? "<unknown type>",
        policyAction,
        action,
        replacement
      }
    })
    .filter((change): change is ChangeRequiringAttention => Boolean(change))
}

const matchesAllowedChange = (change: ChangeRequiringAttention, allowed: AllowedDestructiveChange): boolean => {
  const allowedPolicyAction = normalizeToString(allowed.PolicyAction)
  const allowedAction = normalizeToString(allowed.Action)
  const allowedReplacement = normalizeToString(allowed.Replacement)

  return allowed.LogicalResourceId === change.logicalId &&
    allowed.PhysicalResourceId === change.physicalId &&
    allowed.ResourceType === change.resourceType &&
    allowedPolicyAction === change.policyAction &&
    allowedAction === change.action &&
    allowedReplacement === change.replacement
}

/**
 * Describes a CloudFormation change set, applies waiver logic, and throws if destructive changes remain.
 *
 * @param changeSetName - Name or ARN of the change set.
 * @param stackName - Name or ARN of the stack that owns the change set.
 * @param region - AWS region where the stack resides.
 * @param allowedChanges - Optional waivers that temporarily allow specific destructive changes.
 */
export async function checkDestructiveChangeSet(
  changeSetName: string,
  stackName: string,
  region: string,
  allowedChanges: Array<AllowedDestructiveChange> = []): Promise<void> {
  if (!changeSetName || !stackName || !region) {
    throw new Error("Change set name, stack name, and region are required")
  }

  const client = new CloudFormationClient({region})
  const command = new DescribeChangeSetCommand({
    ChangeSetName: changeSetName,
    StackName: stackName
  })

  const response: DescribeChangeSetCommandOutput = await client.send(command)
  const destructiveChanges = checkDestructiveChanges(response)
  const creationTime = toDate(response.CreationTime)
  const changeSetStackName = response.StackName

  const remainingChanges = destructiveChanges.filter(change => {
    const waiver = allowedChanges.find(allowed => matchesAllowedChange(change, allowed))

    if (!waiver || !creationTime || !changeSetStackName || waiver.StackName !== changeSetStackName) {
      return true
    }

    const expiryDate = toDate(waiver.ExpiryDate)
    if (!expiryDate) {
      return true
    }

    if (expiryDate.getTime() > creationTime.getTime()) {

      console.log(
        // eslint-disable-next-line max-len
        `Allowing destructive change ${change.logicalId} (${change.resourceType}) until ${expiryDate.toISOString()} - ${waiver.AllowedReason}`
      )
      return false
    }

    console.error(
      `Waiver for ${change.logicalId} (${change.resourceType}) expired on ${expiryDate.toISOString()}`
    )
    return true
  })

  if (remainingChanges.length === 0) {
    console.log(`Change set ${changeSetName} for stack ${stackName} has no destructive changes that are not waived.`)
    return
  }

  console.error("Resources that require attention:")
  remainingChanges.forEach(({logicalId, physicalId, resourceType, policyAction, action, replacement}) => {
    console.error(
      // eslint-disable-next-line max-len
      `- LogicalId: ${logicalId}, PhysicalId: ${physicalId}, Type: ${resourceType}, PolicyAction: ${policyAction ?? "<none>"}, Action: ${action ?? "<unknown>"}, Replacement: ${replacement ?? "<none>"}`
    )
  })
  throw new Error(`Change set ${changeSetName} contains destructive changes`)
}
