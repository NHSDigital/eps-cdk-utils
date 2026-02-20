import {readFileSync} from "node:fs"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"
import {describe, expect, test} from "vitest"
import {checkDestructiveChanges} from "../../src/changesets/checkDestructiveChanges"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixturesDir = join(__dirname, "examples")

const loadChangeSet = (filePath: string) => JSON.parse(readFileSync(filePath, "utf-8"))

const destructiveChangeSet = loadChangeSet(join(fixturesDir, "destructive_changeset.json"))
const safeChangeSet = loadChangeSet(join(fixturesDir, "safe_changeset.json"))

describe("checkDestructiveChanges", () => {
  test("returns resources that require replacement", () => {
    const replacements = checkDestructiveChanges(destructiveChangeSet)

    expect(replacements.length).toBeGreaterThan(0)
    expect(replacements).toContainEqual({
      logicalId: "AlarmsAccountLambdaConcurrencyAlarm8AF49AD8",
      physicalId: "monitoring-Account_Lambda_Concurrency",
      resourceType: "AWS::CloudWatch::Alarm",
      reason: "Replacement: True"
    })
  })

  test("returns an empty array when no replacements or removals exist", () => {
    const replacements = checkDestructiveChanges(safeChangeSet)

    expect(replacements).toEqual([])
  })

  test("includes resources marked for removal", () => {
    const changeSet = {
      Changes: [
        {
          ResourceChange: {
            LogicalResourceId: "ResourceToRemove",
            PhysicalResourceId: "physical-id",
            ResourceType: "AWS::S3::Bucket",
            Action: "Remove",
            Replacement: "False"
          }
        }
      ]
    }
    const replacements = checkDestructiveChanges(changeSet)

    expect(replacements).toEqual([
      {
        logicalId: "ResourceToRemove",
        physicalId: "physical-id",
        resourceType: "AWS::S3::Bucket",
        reason: "Action: Remove"
      }
    ])
  })
})
