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
