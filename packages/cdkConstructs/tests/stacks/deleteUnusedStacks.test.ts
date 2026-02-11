import {
  describe,
  test,
  beforeEach,
  afterEach,
  expect,
  vi
} from "vitest"

import {deleteUnusedMainStacks, deleteUnusedPrStacks, getActiveApiVersions} from "../../src/stacks/deleteUnusedStacks"

const mockListStacksSend = vi.fn()
const mockDeleteStackSend = vi.fn()
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mockListHostedZonesByNameSend = vi.fn((_) => ({HostedZones: [{Id: "Z123"}]}))
const mockListResourceRecordSetsSend = vi.fn()
const mockChangeResourceRecordSetsSend = vi.fn()

vi.mock("@aws-sdk/client-cloudformation", () => {
  class CloudFormationClient {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(public config: any = {}) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send(command: any) {
      if (command instanceof ListStacksCommand) {
        return mockListStacksSend(command.input)
      } else if (command instanceof DeleteStackCommand) {
        return mockDeleteStackSend(command.input)
      } else {
        throw new TypeError("Unknown command")
      }
    }
  }

  class ListStacksCommand {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(input: any) {
      this.input = input
    }
  }

  class DeleteStackCommand {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(input: any) {
      this.input = input
    }
  }

  return {CloudFormationClient, ListStacksCommand, DeleteStackCommand}
})

vi.mock("@aws-sdk/client-route-53", () => {
  class Route53Client {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(public config: any = {}) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send(command: any) {
      if (command instanceof ListHostedZonesByNameCommand) {
        return mockListHostedZonesByNameSend(command.input)
      } else if (command instanceof ListResourceRecordSetsCommand) {
        return mockListResourceRecordSetsSend(command.input)
      } else if (command instanceof ChangeResourceRecordSetsCommand) {
        return mockChangeResourceRecordSetsSend(command.input)
      } else {
        throw new TypeError("Unknown command")
      }
    }
  }

  class ListHostedZonesByNameCommand {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(input: any) {
      this.input = input
    }
  }

  class ListResourceRecordSetsCommand {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(input: any) {
      this.input = input
    }
  }

  class ChangeResourceRecordSetsCommand {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(input: any) {
      this.input = input
    }
  }

  return {Route53Client, ListHostedZonesByNameCommand, ListResourceRecordSetsCommand, ChangeResourceRecordSetsCommand}
})

const originalEnv = process.env
const originalFetch = globalThis.fetch

const mockActiveVersion = "v1.2.3"
const mockGetPRState = vi.fn<(url: string) => string>((url: string) => {
  throw new Error(`Unexpected URL: ${url}`)
})

describe("stack deletion", () => {
  const baseStackName = "eps-api"
  const repoName = "eps-cdk-utils"
  const basePath = "status-path"
  const hostedZoneName = "dev.eps.national.nhs.uk."

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      APIGEE_ENVIRONMENT: "prod",
      APIM_STATUS_API_KEY: "test-api-key",
      GITHUB_TOKEN: "test-github-token"
    }

    mockListStacksSend.mockReset()
    mockDeleteStackSend.mockReset()
    mockListHostedZonesByNameSend.mockReset()
    mockListResourceRecordSetsSend.mockReset()
    mockChangeResourceRecordSetsSend.mockReset()
    mockGetPRState.mockReset()

    // By default, no CNAME records are present; individual tests
    // can override this where specific records are required.
    mockListResourceRecordSetsSend.mockReturnValue({ResourceRecordSets: []})

    vi.useFakeTimers()
    vi.setSystemTime(new Date("2024-01-03T00:00:00.000Z"))
  })

  afterEach(() => {
    process.env = originalEnv
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = originalFetch
    vi.useRealTimers()
  })

  describe("deleteUnusedMainStacks", () => {
    test("deletes superseded stacks when embargo has passed", async () => {
      const now = new Date()
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

      mockListStacksSend.mockReturnValue({
        StackSummaries: [
          {
            StackName: `${baseStackName}-v1-2-3`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          },
          {
            StackName: `${baseStackName}-v1-2-2`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          },
          {
            StackName: `${baseStackName}-abcd123`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          }
        ]
      })

      const promise = deleteUnusedMainStacks(
        baseStackName,
        () => Promise.resolve({baseEnvVersion: mockActiveVersion, sandboxEnvVersion: null}),
        hostedZoneName
      )
      await vi.runAllTimersAsync()
      await promise

      // Superseded version should be deleted
      expect(mockDeleteStackSend).toHaveBeenCalledTimes(2)
      expect(mockDeleteStackSend).toHaveBeenCalledWith({StackName: `${baseStackName}-v1-2-2`})
      expect(mockDeleteStackSend).toHaveBeenCalledWith({StackName: `${baseStackName}-abcd123`})
    })

    test("does not delete embargoed versions even if active version is outside embargo period", async () => {
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

      mockListStacksSend.mockReturnValue({
        StackSummaries: [
          {
            StackName: `${baseStackName}-v1-2-3`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          },
          {
            StackName: `${baseStackName}-v1-2-4`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: oneHourAgo
          }
        ]
      })

      const promise = deleteUnusedMainStacks(
        baseStackName,
        () => Promise.resolve({baseEnvVersion: mockActiveVersion, sandboxEnvVersion: null}),
        hostedZoneName
      )
      await vi.runAllTimersAsync()
      await promise

      // No delete stack call should have been made
      expect(mockDeleteStackSend).not.toHaveBeenCalled()
    })

    test("does not delete superseded stack when active version is within embargo period", async () => {
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

      mockListStacksSend.mockReturnValue({
        StackSummaries: [
          {
            StackName: `${baseStackName}-v1-2-3`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: oneHourAgo
          },
          {
            StackName: `${baseStackName}-v1-2-2`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          }
        ]
      })

      const promise = deleteUnusedMainStacks(
        baseStackName,
        () => Promise.resolve({baseEnvVersion: mockActiveVersion, sandboxEnvVersion: null}),
        hostedZoneName
      )
      await vi.runAllTimersAsync()
      await promise

      // No delete stack call should have been made
      expect(mockDeleteStackSend).not.toHaveBeenCalled()
    })

    test("deletes superseded sandbox stacks when embargo has passed", async () => {
      const now = new Date()
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

      process.env.APIGEE_ENVIRONMENT = "int"

      mockListResourceRecordSetsSend.mockReturnValue({
        ResourceRecordSets: [
          {
            Name: `${baseStackName}-sandbox-v1-2-3.dev.eps.national.nhs.uk.`,
            Type: "CNAME"
          },
          {
            Name: `${baseStackName}-sandbox-v1-2-2.dev.eps.national.nhs.uk.`,
            Type: "CNAME"
          }
        ]
      })

      mockListStacksSend.mockReturnValue({
        StackSummaries: [
          {
            StackName: `${baseStackName}-v1-2-3`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          },
          {
            StackName: `${baseStackName}-sandbox-v1-2-3`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          },
          {
            StackName: `${baseStackName}-sandbox-v1-2-2`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          }
        ]
      })

      const promise = deleteUnusedMainStacks(
        baseStackName,
        () => Promise.resolve({baseEnvVersion: mockActiveVersion, sandboxEnvVersion: mockActiveVersion}),
        hostedZoneName
      )
      await vi.runAllTimersAsync()
      await promise

      // Superseded sandbox version should be deleted
      expect(mockDeleteStackSend).toHaveBeenCalledTimes(1)
      expect(mockDeleteStackSend).toHaveBeenCalledWith({StackName: `${baseStackName}-sandbox-v1-2-2`})

      // CNAME deletion for the superseded sandbox stack
      expect(mockChangeResourceRecordSetsSend).toHaveBeenCalledTimes(1)
      expect(mockChangeResourceRecordSetsSend).toHaveBeenCalledWith({
        HostedZoneId: "Z123",
        ChangeBatch: {
          Changes: [{
            Action: "DELETE",
            ResourceRecordSet: {
              Name: `${baseStackName}-sandbox-v1-2-2.dev.eps.national.nhs.uk.`,
              Type: "CNAME"
            }
          }]
        }
      })
    })

    test("does not delete CNAME records if no hosted zone name is provided", async () => {
      const now = new Date()
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

      process.env.APIGEE_ENVIRONMENT = "int"

      mockListStacksSend.mockReturnValue({
        StackSummaries: [
          {
            StackName: `${baseStackName}-v1-2-3`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          },
          {
            StackName: `${baseStackName}-v1-2-2`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          }
        ]
      })

      const promise = deleteUnusedMainStacks(
        baseStackName,
        () => Promise.resolve({baseEnvVersion: mockActiveVersion, sandboxEnvVersion: null}),
        undefined
      )
      await vi.runAllTimersAsync()
      await promise

      // Superseded sandbox version should be deleted
      expect(mockDeleteStackSend).toHaveBeenCalledTimes(1)
      expect(mockDeleteStackSend).toHaveBeenCalledWith({StackName: `${baseStackName}-v1-2-2`})

      // No CNAME deletion should have been made
      expect(mockChangeResourceRecordSetsSend).not.toHaveBeenCalled()
    })

    test("does not delete CNAME records if hosted zone cannot be found", async () => {
      const now = new Date()
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

      process.env.APIGEE_ENVIRONMENT = "int"

      mockListHostedZonesByNameSend.mockReturnValueOnce({HostedZones: []})

      mockListStacksSend.mockReturnValue({
        StackSummaries: [
          {
            StackName: `${baseStackName}-v1-2-3`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          },
          {
            StackName: `${baseStackName}-v1-2-2`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          }
        ]
      })

      const promise = deleteUnusedMainStacks(
        baseStackName,
        () => Promise.resolve({baseEnvVersion: mockActiveVersion, sandboxEnvVersion: null}),
        hostedZoneName
      )
      await vi.runAllTimersAsync()
      await promise

      // Superseded sandbox version should be deleted
      expect(mockDeleteStackSend).toHaveBeenCalledTimes(1)
      expect(mockDeleteStackSend).toHaveBeenCalledWith({StackName: `${baseStackName}-v1-2-2`})

      // No CNAME deletion should have been made
      expect(mockChangeResourceRecordSetsSend).not.toHaveBeenCalled()
    })

    test("does not delete CNAME records if no CNAME records are found", async () => {
      const now = new Date()
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

      process.env.APIGEE_ENVIRONMENT = "int"
      mockListResourceRecordSetsSend.mockReturnValueOnce({})

      mockListStacksSend.mockReturnValue({
        StackSummaries: [
          {
            StackName: `${baseStackName}-v1-2-3`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          },
          {
            StackName: `${baseStackName}-v1-2-2`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          }
        ]
      })

      const promise = deleteUnusedMainStacks(
        baseStackName,
        () => Promise.resolve({baseEnvVersion: mockActiveVersion, sandboxEnvVersion: null}),
        hostedZoneName
      )
      await vi.runAllTimersAsync()
      await promise

      // Superseded sandbox version should be deleted
      expect(mockDeleteStackSend).toHaveBeenCalledTimes(1)
      expect(mockDeleteStackSend).toHaveBeenCalledWith({StackName: `${baseStackName}-v1-2-2`})

      // No CNAME deletion should have been made
      expect(mockChangeResourceRecordSetsSend).not.toHaveBeenCalled()
    })

    test("deletes superseded internal-dev sandbox stacks when embargo has passed", async () => {
      const now = new Date()
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

      process.env.APIGEE_ENVIRONMENT = "internal-dev"

      mockListResourceRecordSetsSend.mockReturnValue({
        ResourceRecordSets: [
          {
            Name: `${baseStackName}-sandbox-v1-2-3.dev.eps.national.nhs.uk.`,
            Type: "CNAME"
          },
          {
            Name: `${baseStackName}-sandbox-v1-2-2.dev.eps.national.nhs.uk.`,
            Type: "CNAME"
          }
        ]
      })

      mockListStacksSend.mockReturnValue({
        StackSummaries: [
          {
            StackName: `${baseStackName}-v1-2-3`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          },
          {
            StackName: `${baseStackName}-sandbox-v1-2-3`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          },
          {
            StackName: `${baseStackName}-sandbox-v1-2-2`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          }
        ]
      })

      const promise = deleteUnusedMainStacks(
        baseStackName,
        () => Promise.resolve({baseEnvVersion: mockActiveVersion, sandboxEnvVersion: mockActiveVersion}),
        hostedZoneName
      )
      await vi.runAllTimersAsync()
      await promise

      // Superseded sandbox version should be deleted
      expect(mockDeleteStackSend).toHaveBeenCalledTimes(1)
      expect(mockDeleteStackSend).toHaveBeenCalledWith({StackName: `${baseStackName}-sandbox-v1-2-2`})

      // CNAME deletion for the superseded sandbox stack
      expect(mockChangeResourceRecordSetsSend).toHaveBeenCalledTimes(1)
      expect(mockChangeResourceRecordSetsSend).toHaveBeenCalledWith({
        HostedZoneId: "Z123",
        ChangeBatch: {
          Changes: [{
            Action: "DELETE",
            ResourceRecordSet: {
              Name: `${baseStackName}-sandbox-v1-2-2.dev.eps.national.nhs.uk.`,
              Type: "CNAME"
            }
          }]
        }
      })
    })

    test("still deletes non sandbox superseded stacks when sandbox state is unavailable", async () => {
      const now = new Date()
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

      process.env.APIGEE_ENVIRONMENT = "int"

      mockListStacksSend.mockReturnValue({
        StackSummaries: [
          {
            StackName: `${baseStackName}-v1-2-3`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          },
          {
            StackName: `${baseStackName}-v1-2-2`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          },
          {
            StackName: `${baseStackName}-sandbox-v1-2-3`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          },
          {
            StackName: `${baseStackName}-sandbox-v1-2-2`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          }
        ]
      })

      const promise = deleteUnusedMainStacks(
        baseStackName,
        () => Promise.resolve({baseEnvVersion: mockActiveVersion, sandboxEnvVersion: null}),
        hostedZoneName
      )
      await vi.runAllTimersAsync()
      await promise

      // Superseded version should be deleted
      expect(mockDeleteStackSend).toHaveBeenCalledTimes(1)
      expect(mockDeleteStackSend).toHaveBeenCalledWith({StackName: `${baseStackName}-v1-2-2`})
    })

    test("ignores PR stacks", async () => {
      const now = new Date()
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

      mockListStacksSend.mockReturnValue({
        StackSummaries: [
          {
            StackName: `${baseStackName}-pr-123`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          }
        ]
      })

      const promise = deleteUnusedMainStacks(
        baseStackName,
        () => Promise.resolve({baseEnvVersion: mockActiveVersion, sandboxEnvVersion: null}),
        hostedZoneName
      )
      await vi.runAllTimersAsync()
      await promise

      // No delete stack call should have been made
      expect(mockDeleteStackSend).not.toHaveBeenCalled()
    })

    test("skips stacks with DELETE_COMPLETE status", async () => {
      const now = new Date()
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

      mockListStacksSend.mockReturnValue({
        StackSummaries: [
          {
            StackName: `${baseStackName}-v1-2-2`,
            StackStatus: "DELETE_COMPLETE",
            CreationTime: twoDaysAgo
          }
        ]
      })

      const promise = deleteUnusedMainStacks(
        baseStackName,
        () => Promise.resolve({baseEnvVersion: mockActiveVersion, sandboxEnvVersion: null}),
        hostedZoneName
      )
      await vi.runAllTimersAsync()
      await promise

      // No delete stack call should have been made
      expect(mockDeleteStackSend).not.toHaveBeenCalled()
    })
  })

  describe("getActiveApiVersions", () => {
    test("fetches active version for prod environment", async () => {
      process.env.APIGEE_ENVIRONMENT = "prod"

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).fetch = vi.fn((url: string) => {
        expect(url).toBe(`https://api.service.nhs.uk/${basePath}/_status`)
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({checks: {healthcheck: {outcome: {versionNumber: "v2.0.0"}}}})
        })
      })

      const result = await getActiveApiVersions(basePath)

      expect(result).toEqual({
        baseEnvVersion: "v2.0.0",
        sandboxEnvVersion: null
      })
    })

    test("fetches active version for int environment with sandbox", async () => {
      process.env.APIGEE_ENVIRONMENT = "int"

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).fetch = vi.fn((url: string) => {
        if (url === `https://int.api.service.nhs.uk/${basePath}/_status`) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => "",
            json: async () => ({checks: {healthcheck: {outcome: {versionNumber: "v1.5.0"}}}})
          })
        } else if (url === `https://sandbox.api.service.nhs.uk/${basePath}/_status`) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => "",
            json: async () => ({checks: {healthcheck: {outcome: {versionNumber: "v1.5.1"}}}})
          })
        }
        throw new Error(`Unexpected URL: ${url}`)
      })

      const result = await getActiveApiVersions(basePath)

      expect(result).toEqual({
        baseEnvVersion: "v1.5.0",
        sandboxEnvVersion: "v1.5.1"
      })
    })

    test("fetches active version for internal-dev environment with sandbox", async () => {
      process.env.APIGEE_ENVIRONMENT = "internal-dev"

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).fetch = vi.fn((url: string) => {
        if (url === `https://internal-dev.api.service.nhs.uk/${basePath}/_status`) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => "",
            json: async () => ({checks: {healthcheck: {outcome: {versionNumber: "v1.3.0"}}}})
          })
        } else if (url === `https://internal-dev-sandbox.api.service.nhs.uk/${basePath}/_status`) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => "",
            json: async () => ({checks: {healthcheck: {outcome: {versionNumber: "v1.3.2"}}}})
          })
        }
        throw new Error(`Unexpected URL: ${url}`)
      })

      const result = await getActiveApiVersions(basePath)

      expect(result).toEqual({
        baseEnvVersion: "v1.3.0",
        sandboxEnvVersion: "v1.3.2"
      })
    })

    test("handles sandbox environment fetch failure gracefully", async () => {
      process.env.APIGEE_ENVIRONMENT = "int"

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).fetch = vi.fn((url: string) => {
        if (url === `https://int.api.service.nhs.uk/${basePath}/_status`) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => "",
            json: async () => ({checks: {healthcheck: {outcome: {versionNumber: "v1.7.0"}}}})
          })
        } else if (url === `https://sandbox.api.service.nhs.uk/${basePath}/_status`) {
          return Promise.resolve({
            ok: false,
            status: 503,
            text: async () => "Service Unavailable"
          })
        }
        throw new Error(`Unexpected URL: ${url}`)
      })

      const result = await getActiveApiVersions(basePath)

      expect(result).toEqual({
        baseEnvVersion: "v1.7.0",
        sandboxEnvVersion: null
      })
    })

    test("throws error when base environment fetch fails", async () => {
      process.env.APIGEE_ENVIRONMENT = "prod"

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).fetch = vi.fn(() => {
        return Promise.resolve({
          ok: false,
          status: 404,
          text: async () => "Not Found"
        })
      })

      await expect(getActiveApiVersions(basePath)).rejects.toThrow(
        `Failed to fetch active version from https://api.service.nhs.uk/${basePath}/_status: 404 Not Found`
      )
    })

    test("does not fetch sandbox for non-int/internal-dev environments", async () => {
      process.env.APIGEE_ENVIRONMENT = "ref"

      const mockFetch = vi.fn((url: string) => {
        if (url === `https://ref.api.service.nhs.uk/${basePath}/_status`) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => "",
            json: async () => ({checks: {healthcheck: {outcome: {versionNumber: "v1.9.0"}}}})
          })
        }
        throw new Error(`Unexpected URL: ${url}`)
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).fetch = mockFetch

      const result = await getActiveApiVersions(basePath)

      expect(result).toEqual({
        baseEnvVersion: "v1.9.0",
        sandboxEnvVersion: null
      })

      // Should only have called fetch once (for base environment)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    test("includes authorization header in requests", async () => {
      process.env.APIGEE_ENVIRONMENT = "prod"
      const testApiKey = "test-api-key-value"
      process.env.APIM_STATUS_API_KEY = testApiKey

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockFetch = vi.fn((_url: string, options: any) => {
        expect(options.headers.apikey).toBe(testApiKey)
        expect(options.headers.Accept).toBe("application/json")
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({checks: {healthcheck: {outcome: {versionNumber: "v2.1.0"}}}})
        })
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).fetch = mockFetch

      const result = await getActiveApiVersions(basePath)

      expect(result).toEqual({
        baseEnvVersion: "v2.1.0",
        sandboxEnvVersion: null
      })
      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe("deleteUnusedPrStacks", () => {
    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).fetch = (url: string) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({state: mockGetPRState(url)})
        })
      }
    })

    test("deletes closed PR stacks and CNAME records", async () => {
      const now = new Date()
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

      mockListStacksSend.mockReturnValue({
        StackSummaries: [
          {
            StackName: `${baseStackName}-v1-2-3`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          },
          {
            StackName: `${baseStackName}-pr-123`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          }
        ]
      })

      mockListResourceRecordSetsSend.mockReturnValue({
        ResourceRecordSets: [
          {
            Name: `${baseStackName}-pr-123.dev.eps.national.nhs.uk.`,
            Type: "CNAME"
          }
        ]
      })

      mockGetPRState.mockImplementation((url: string) => {
        if (url.endsWith("/repos/NHSDigital/eps-cdk-utils/pulls/123")) {
          return "closed"
        }
        throw new Error(`Unexpected URL: ${url}`)
      })

      const promise = deleteUnusedPrStacks(baseStackName, repoName, hostedZoneName)
      await vi.runAllTimersAsync()
      await promise

      // One delete stack call for the PR stack
      expect(mockDeleteStackSend).toHaveBeenCalledTimes(1)
      expect(mockDeleteStackSend).toHaveBeenCalledWith({StackName: `${baseStackName}-pr-123`})

      // CNAME deletion for the PR stack
      expect(mockChangeResourceRecordSetsSend).toHaveBeenCalledTimes(1)
      expect(mockChangeResourceRecordSetsSend).toHaveBeenCalledWith({
        HostedZoneId: "Z123",
        ChangeBatch: {
          Changes: [{
            Action: "DELETE",
            ResourceRecordSet: {
              Name: `${baseStackName}-pr-123.dev.eps.national.nhs.uk.`,
              Type: "CNAME"
            }
          }]
        }
      })
    })

    test("does not delete open PR stacks", async () => {
      const now = new Date()
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

      mockListStacksSend.mockReturnValue({
        StackSummaries: [
          {
            StackName: `${baseStackName}-pr-456`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          }
        ]
      })

      mockGetPRState.mockImplementation((url: string) => {
        if (url.endsWith("/repos/NHSDigital/eps-cdk-utils/pulls/456")) {
          return "open"
        }
        throw new Error(`Unexpected URL: ${url}`)
      })

      const promise = deleteUnusedPrStacks(baseStackName, repoName, hostedZoneName)
      await vi.runAllTimersAsync()
      await promise

      // No delete stack call should have been made
      expect(mockDeleteStackSend).not.toHaveBeenCalled()

      // No CNAME deletion should have been made
      expect(mockChangeResourceRecordSetsSend).not.toHaveBeenCalled()
    })

    test("handles multiple pages of CloudFormation stacks", async () => {
      const now = new Date()
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

      mockListStacksSend.mockImplementation(({NextToken}) => {
        if (!NextToken) {
          return {
            StackSummaries: [
              {
                StackName: `${baseStackName}-v1-2-3`,
                StackStatus: "CREATE_COMPLETE",
                CreationTime: twoDaysAgo
              }
            ],
            NextToken: "token-1"
          }
        }

        return {
          StackSummaries: [
            {
              StackName: `${baseStackName}-pr-789`,
              StackStatus: "CREATE_COMPLETE",
              CreationTime: twoDaysAgo
            }
          ]
        }
      })

      mockGetPRState.mockImplementation((url: string) => {
        if (url.endsWith("/repos/NHSDigital/eps-cdk-utils/pulls/789")) {
          return "closed"
        }
        throw new Error(`Unexpected URL: ${url}`)
      })

      const promise = deleteUnusedPrStacks(baseStackName, repoName, hostedZoneName)
      await vi.runAllTimersAsync()
      await promise

      // Both pages of stacks should have been requested
      expect(mockListStacksSend).toHaveBeenCalledTimes(2)

      // PR stack from the second page should be deleted
      expect(mockDeleteStackSend).toHaveBeenCalledTimes(1)
      expect(mockDeleteStackSend).toHaveBeenCalledWith({StackName: `${baseStackName}-pr-789`})
    })

    test("skips stacks with DELETE_COMPLETE status", async () => {
      const now = new Date()
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

      mockListStacksSend.mockReturnValue({
        StackSummaries: [
          {
            StackName: `${baseStackName}-pr-101`,
            StackStatus: "DELETE_COMPLETE",
            CreationTime: twoDaysAgo
          }
        ]
      })

      const promise = deleteUnusedPrStacks(baseStackName, repoName, hostedZoneName)
      await vi.runAllTimersAsync()
      await promise

      // No delete stack call should have been made
      expect(mockDeleteStackSend).not.toHaveBeenCalled()

      // No CNAME deletion should have been made
      expect(mockChangeResourceRecordSetsSend).not.toHaveBeenCalled()
    })

    test("skips PR stacks when fetching PR state fails", async () => {
      const now = new Date()
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

      mockListStacksSend.mockReturnValue({
        StackSummaries: [
          {
            StackName: `${baseStackName}-pr-202`,
            StackStatus: "CREATE_COMPLETE",
            CreationTime: twoDaysAgo
          }
        ]
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).fetch = (url: string) => {
        if (url.includes("api.github.com")) {
          return Promise.resolve({
            ok: false,
            status: 500,
            text: async () => "Error fetching PR"
          })
        }
        // Default mock for other fetch calls
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({checks: {healthcheck: {outcome: {versionNumber: mockActiveVersion}}}})
        })
      }

      const promise = deleteUnusedPrStacks(baseStackName, repoName, hostedZoneName)
      await vi.runAllTimersAsync()
      await promise

      // No delete stack call should have been made
      expect(mockDeleteStackSend).not.toHaveBeenCalled()

      // No CNAME deletion should have been made
      expect(mockChangeResourceRecordSetsSend).not.toHaveBeenCalled()
    })

    test("handles no stacks returned", async () => {
      mockListStacksSend.mockReturnValue({})

      const promise = deleteUnusedPrStacks(baseStackName, repoName, hostedZoneName)
      await vi.runAllTimersAsync()
      await promise

      // No delete stack call should have been made
      expect(mockDeleteStackSend).not.toHaveBeenCalled()

      // No CNAME deletion should have been made
      expect(mockChangeResourceRecordSetsSend).not.toHaveBeenCalled()
    })
  })
})
