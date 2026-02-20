import {
  CloudFormationClient,
  DescribeChangeSetCommand,
  DescribeChangeSetCommandOutput,
  Change as CloudFormationChange
} from "@aws-sdk/client-cloudformation"

export type ChangeRequiringAttention = {
  logicalId: string;
  physicalId: string;
  resourceType: string;
  reason: string;
}

export type AllowedDestructiveChange = {
  LogicalResourceId: string;
  PhysicalResourceId: string;
  ResourceType: string;
  ExpiryDate: string | Date;
  AllowedReason: string;
}

const requiresReplacement = (replacement: unknown): boolean => {
  if (replacement === undefined || replacement === null) {
    return false
  }

  const normalized = String(replacement)
  return normalized === "True" || normalized === "Conditional"
}

const toDate = (value: Date | string | number | undefined | null): Date | undefined => {
  if (value === undefined || value === null) {
    return undefined
  }

  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

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

      const replacementNeeded = requiresReplacement(resourceChange.Replacement)
      const action = resourceChange.Action
      const isRemoval = action === "Remove"

      if (!replacementNeeded && !isRemoval) {
        return undefined
      }

      return {
        logicalId: resourceChange.LogicalResourceId ?? "<unknown logical id>",
        physicalId: resourceChange.PhysicalResourceId ?? "<unknown physical id>",
        resourceType: resourceChange.ResourceType ?? "<unknown type>",
        reason: replacementNeeded
          ? `Replacement: ${String(resourceChange.Replacement)}`
          : `Action: ${action ?? "<unknown action>"}`
      }
    })
    .filter((change): change is ChangeRequiringAttention => Boolean(change))
}

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

  const remainingChanges = destructiveChanges.filter(change => {
    const waiver = allowedChanges.find(allowed =>
      allowed.LogicalResourceId === change.logicalId &&
      allowed.PhysicalResourceId === change.physicalId &&
      allowed.ResourceType === change.resourceType
    )

    if (!waiver || !creationTime) {
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
    console.log(`Change set ${changeSetName} for stack ${stackName} has no destructive changes.`)
    return
  }

  console.error("Resources that require attention:")
  remainingChanges.forEach(({logicalId, physicalId, resourceType, reason}) => {
    console.error(`- LogicalId: ${logicalId}, PhysicalId: ${physicalId}, Type: ${resourceType}, Reason: ${reason}`)
  })
  throw new Error(`Change set ${changeSetName} contains destructive changes`)
}
