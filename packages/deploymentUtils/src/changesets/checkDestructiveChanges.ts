import {readFileSync} from "node:fs"

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

export function checkDestructiveChanges(filePath: string): Array<ChangeRequiringAttention> {
  if (!filePath) {
    throw new Error("A change set file path must be provided")
  }

  const raw = readFileSync(filePath, "utf-8")
  const data = JSON.parse(raw)
  const changes = Array.isArray(data?.Changes) ? data.Changes : []

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
