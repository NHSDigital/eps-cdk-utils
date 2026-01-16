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
  getTrustStoreVersion
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

  class DescribeStacksCommand {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(input: any) {
      this.input = input
    }
  }

  return {CloudFormationClient, DescribeStacksCommand}
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
    process.env.CDK_CONFIG_STACK_NAME = "primary"

    expect(getConfigFromEnvVar("STACK_NAME")).toBe("primary")
  })

  test("getConfigFromEnvVar throws when value is missing", () => {
    delete process.env.CDK_CONFIG_MISSING

    expect(() => getConfigFromEnvVar("MISSING"))
      .toThrow("Environment variable CDK_CONFIG_MISSING is not set")
  })

  test("getConfigFromEnvVar supports alternate prefixes", () => {
    process.env.APP_CUSTOM_VALUE = "alt"

    expect(getConfigFromEnvVar("CUSTOM_VALUE", "APP_")).toBe("alt")
  })

  test("getBooleanConfigFromEnvVar maps string booleans", () => {
    process.env.CDK_CONFIG_FEATURE_FLAG = "true "
    process.env.CDK_CONFIG_OTHER_FLAG = " false"

    expect(getBooleanConfigFromEnvVar("FEATURE_FLAG")).toBe(true)
    expect(getBooleanConfigFromEnvVar("OTHER_FLAG")).toBe(false)
  })

  test("getNumberConfigFromEnvVar parses numeric strings", () => {
    process.env.CDK_CONFIG_TIMEOUT = "45"

    expect(getNumberConfigFromEnvVar("TIMEOUT")).toBe(45)
  })

  test("getTrustStoreVersion returns the version ID from S3", async () => {
    mockCloudFormationSend.mockResolvedValueOnce({
      Stacks: [{
        Outputs: [{OutputKey: "TrustStoreBucket", OutputValue: "arn:aws:s3:::nhs-trust"}]
      }]
    })
    mockS3Send.mockResolvedValueOnce({VersionId: "abc123"})

    const version = await getTrustStoreVersion("truststore.pem", "eu-central-1")

    expect(version).toBe("abc123")

    expect(createdCfnClients.at(-1)?.region).toBe("eu-central-1")
    expect(createdS3Clients.at(-1)?.region).toBe("eu-central-1")

    const describeCommand = mockCloudFormationSend.mock.calls[0][0] as {input: {StackName: string}}
    expect(describeCommand.input.StackName).toBe("account-resources")

    const headCommand = mockS3Send.mock.calls[0][0] as {input: {Bucket: string, Key: string}}
    expect(headCommand.input).toEqual({Bucket: "nhs-trust", Key: "truststore.pem"})
  })
})
