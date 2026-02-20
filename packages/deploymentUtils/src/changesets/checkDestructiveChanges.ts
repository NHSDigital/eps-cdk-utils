import {CloudFormationClient, DescribeChangeSetCommand} from "@aws-sdk/client-cloudformation"

export type ChangeRequiringAttention = {
  logicalId: string;
  physicalId: string;
  resourceType: string;
  reason: string;
}

type RawChange = {
  ResourceChange?: {
    LogicalResourceId?: string;
    PhysicalResourceId?: string;
    ResourceType?: string;
    Replacement?: unknown;
    Action?: string;
  } | null;
}

const requiresReplacement = (replacement: unknown): boolean => {
  if (replacement === undefined || replacement === null) {
    return false
  }

  const normalized = String(replacement)
  return normalized === "True" || normalized === "Conditional"
}

type ChangeSet = {
  Changes?: unknown;
}

export function checkDestructiveChanges(changeSet: ChangeSet | undefined | null): Array<ChangeRequiringAttention> {
  if (!changeSet || typeof changeSet !== "object") {
    throw new Error("A change set object must be provided")
  }

  const {Changes} = changeSet as ChangeSet
  const changes = Array.isArray(Changes) ? (Changes as Array<RawChange>) : []

  return changes
    .map((change: RawChange) => {
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
  region: string): Promise<void> {
  if (!changeSetName || !stackName || !region) {
    throw new Error("Change set name, stack name, and region are required")
  }

  const client = new CloudFormationClient({region})
  const command = new DescribeChangeSetCommand({
    ChangeSetName: changeSetName,
    StackName: stackName
  })

  const response = await client.send(command)
  const destructiveChanges = checkDestructiveChanges(response)

  if (destructiveChanges.length === 0) {
    console.log(`Change set ${changeSetName} for stack ${stackName} has no destructive changes.`)
    return
  }

  console.error("Resources that require attention:")
  destructiveChanges.forEach(({logicalId, physicalId, resourceType, reason}) => {
    console.error(`- LogicalId: ${logicalId}, PhysicalId: ${physicalId}, Type: ${resourceType}, Reason: ${reason}`)
  })
  throw new Error(`Change set ${changeSetName} contains destructive changes`)
}
