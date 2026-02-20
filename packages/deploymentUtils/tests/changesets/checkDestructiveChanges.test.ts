import {readFileSync} from "node:fs"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"
import {
  beforeEach,
  describe,
  expect,
  test,
  vi
} from "vitest"
import {checkDestructiveChanges, checkDestructiveChangeSet} from "../../src/changesets/checkDestructiveChanges"

const mockCloudFormationSend = vi.fn()

vi.mock("@aws-sdk/client-cloudformation", () => {
  class CloudFormationClient {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any
    constructor(config: {region: string}) {
      this.config = config
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send(command: any) {
      return mockCloudFormationSend(command)
    }
  }

  class DescribeChangeSetCommand {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(input: any) {
      this.input = input
    }
  }

  return {CloudFormationClient, DescribeChangeSetCommand}
})

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixturesDir = join(__dirname, "examples")

const loadChangeSet = (filePath: string) => JSON.parse(readFileSync(filePath, "utf-8"))

const destructiveChangeSet = loadChangeSet(join(fixturesDir, "destructive_changeset.json"))
const safeChangeSet = loadChangeSet(join(fixturesDir, "safe_changeset.json"))

beforeEach(() => {
  mockCloudFormationSend.mockReset()
})

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

describe("checkDestructiveChangeSet", () => {
  test("logs success when no destructive changes are present", async () => {
    mockCloudFormationSend.mockResolvedValueOnce(safeChangeSet)

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    try {
      await expect(checkDestructiveChangeSet("cs", "stack", "eu-west-2")).resolves.toBeUndefined()

      expect(mockCloudFormationSend).toHaveBeenCalledTimes(1)
      const command = mockCloudFormationSend.mock.calls[0][0] as {input: {ChangeSetName: string; StackName: string}}
      expect(command.input).toEqual({ChangeSetName: "cs", StackName: "stack"})
      expect(logSpy).toHaveBeenCalledWith("Change set cs for stack stack has no destructive changes.")
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      logSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })

  test("logs details and throws when destructive changes exist", async () => {
    mockCloudFormationSend.mockResolvedValueOnce(destructiveChangeSet)

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    try {
      await expect(checkDestructiveChangeSet("cs", "stack", "eu-west-2"))
        .rejects.toThrow("Change set cs contains destructive changes")

      expect(mockCloudFormationSend).toHaveBeenCalledTimes(1)
      expect(logSpy).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith("Resources that require attention:")
    } finally {
      logSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })
})
