import {
  describe,
  test,
  beforeEach,
  afterAll,
  expect,
  vi
} from "vitest"
import {
  getConfigFromEnvVar,
  getBooleanConfigFromEnvVar,
  getNumberConfigFromEnvVar,
  getCloudFormationExports,
  getCFConfigValue,
  getBooleanCFConfigValue
} from "../../src/config/index"

const mockCloudFormationSend = vi.fn()
const mockS3Send = vi.fn()
const createdCfnClients: Array<{region?: string}> = []
const createdS3Clients: Array<{region?: string}> = []

vi.mock("@aws-sdk/client-cloudformation", () => {
  class CloudFormationClient {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any
    constructor(config: {region: string}) {
      this.config = config
      createdCfnClients.push({region: config.region})
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send(command: any) {
      return mockCloudFormationSend(command)
    }
  }

  class ListExportsCommand {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(input: any) {
      this.input = {...input}
    }
  }

  return {CloudFormationClient, ListExportsCommand}
})

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any
    constructor(config: {region: string}) {
      this.config = config
      createdS3Clients.push({region: config.region})
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send(command: any) {
      return mockS3Send(command)
    }
  }

  class HeadObjectCommand {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(input: any) {
      this.input = input
    }
  }

  return {S3Client, HeadObjectCommand}
})

const ORIGINAL_ENV = process.env

describe("config helpers", () => {
  beforeEach(() => {
    process.env = {...ORIGINAL_ENV}
    mockCloudFormationSend.mockReset()
    mockS3Send.mockReset()
    createdCfnClients.length = 0
    createdS3Clients.length = 0
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  test("getConfigFromEnvVar returns the configured value", () => {
    process.env.STACK_NAME = "primary"

    expect(getConfigFromEnvVar("STACK_NAME")).toBe("primary")
  })

  test("getConfigFromEnvVar throws when value is missing", () => {
    delete process.env.MISSING

    expect(() => getConfigFromEnvVar("MISSING"))
      .toThrow("Environment variable MISSING is not set")
  })

  test("getBooleanConfigFromEnvVar maps string booleans", () => {
    process.env.FEATURE_FLAG = "true"
    process.env.OTHER_FLAG = "false"

    expect(getBooleanConfigFromEnvVar("FEATURE_FLAG")).toBe(true)
    expect(getBooleanConfigFromEnvVar("OTHER_FLAG")).toBe(false)
  })

  test("getNumberConfigFromEnvVar parses numeric strings", () => {
    process.env.TIMEOUT = "45"

    expect(getNumberConfigFromEnvVar("TIMEOUT")).toBe(45)
  })

  test("getCloudFormationExports aggregates paginated results", async () => {
    mockCloudFormationSend
      .mockResolvedValueOnce({
        Exports: [{Name: "exportA", Value: "valueA"}],
        NextToken: "next"
      })
      .mockResolvedValueOnce({
        Exports: [
          {Name: "exportB", Value: "valueB"},
          {Name: "missingValue", Value: undefined}
        ]
      })

    const exports = await getCloudFormationExports("eu-west-1")

    expect(mockCloudFormationSend).toHaveBeenCalledTimes(2)
    expect(exports).toEqual({exportA: "valueA", exportB: "valueB"})
  })

  test("getCFConfigValue returns values and throws when missing", () => {
    const exports = {foo: "bar"}

    expect(getCFConfigValue(exports, "foo")).toBe("bar")
    expect(() => getCFConfigValue(exports, "baz")).toThrow("CloudFormation export baz not found")
  })

  test("getBooleanCFConfigValue interprets true/false strings", () => {
    const exports = {flagTrue: "TRUE", flagFalse: "false"}

    expect(getBooleanCFConfigValue(exports, "flagTrue")).toBe(true)
    expect(getBooleanCFConfigValue(exports, "flagFalse")).toBe(false)
  })
})
