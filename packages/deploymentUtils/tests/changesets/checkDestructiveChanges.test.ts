import {mkdtempSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"
import {describe, expect, test} from "vitest"
import {checkDestructiveChanges} from "../../src/changesets/checkDestructiveChanges"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixturesDir = join(__dirname, "examples")

const destructiveChangeSet = join(fixturesDir, "destructive_changeset.json")
const safeChangeSet = join(fixturesDir, "safe_changeset.json")

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
    const tempDir = mkdtempSync(join(tmpdir(), "changeset-"))
    const removalFixture = join(tempDir, "removal.json")
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
    writeFileSync(removalFixture, JSON.stringify(changeSet), "utf-8")

    const replacements = checkDestructiveChanges(removalFixture)

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
