import {
  beforeEach,
  afterEach,
  describe,
  expect,
  test,
  vi
} from "vitest"
import {deleteProxygenDeployments} from "../../src/specifications/deleteProxygenDeployments"

const getCloudFormationExportsMock = vi.hoisted(() => vi.fn())
const invokeLambdaMock = vi.hoisted(() => vi.fn())

vi.mock("../../src/config/index", async (importOriginal) => {
  const originalModule = await importOriginal<typeof import("../../src/config/index")>()
  return {
    ...originalModule,
    getCloudFormationExports: getCloudFormationExportsMock
  }
})

vi.mock("../../src/specifications/invokeLambda", async () => {
  return {
    invokeLambda: invokeLambdaMock
  }
})

const originalFetch = globalThis.fetch

function createFetchResponse(state: string, ok = true, status = 200, textBody = "") {
  return Promise.resolve({
    ok,
    status,
    text: async () => textBody,
    json: async () => ({state})
  }) as unknown as Promise<Response>
}

describe("deleteProxygenDeployments", () => {
  beforeEach(() => {
    getCloudFormationExportsMock.mockReset().mockResolvedValue({
      "account-resources:proxygenKey": "arn:proxygen-key"
    })
    invokeLambdaMock.mockReset()

    // default fetch mock; tests can override behaviour
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = vi.fn((url: string) => {
      if (url.includes("/pulls/456")) {
        return createFetchResponse("open")
      }
      return createFetchResponse("closed")
    })
  })

  afterEach(() => {
    // restore original fetch between tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = originalFetch
  })

  test("deletes instances whose pull requests are closed in both environments", async () => {
    const deletePayloads: Array<{environment: string, instance: string}> = []
    invokeLambdaMock.mockImplementation(async (_lambda, _dryRun, functionName: string, payload: unknown) => {
      if (functionName === "lambda-resources-ProxygenPTLInstanceGet") {
        const {apiName} = payload as {apiName: string}
        return JSON.stringify([{name: `${apiName}-pr-123`}])
      }
      if (functionName === "lambda-resources-ProxygenPTLInstanceDelete") {
        deletePayloads.push(payload as {environment: string, instance: string})
        return "\"deleted\""
      }
      return "\"ok\""
    })

    await deleteProxygenDeployments("eps", "eps-repo", "proxygenKey", "kid-123")

    expect(deletePayloads).toEqual(expect.arrayContaining([
      expect.objectContaining({environment: "internal-dev", instance: "eps-pr-123"}),
      expect.objectContaining({environment: "internal-dev-sandbox", instance: "eps-pr-123"})
    ]))
  })

  test("does not delete instances for open pull requests or non-PR names", async () => {
    let deleteCalls = 0
    invokeLambdaMock.mockImplementation(async (_lambda, _dryRun, functionName: string) => {
      if (functionName === "lambda-resources-ProxygenPTLInstanceGet") {
        return JSON.stringify([
          {name: "eps-pr-456"},
          {name: "eps"}
        ])
      }
      if (functionName === "lambda-resources-ProxygenPTLInstanceDelete") {
        deleteCalls++
        return "\"deleted\""
      }
      return "\"ok\""
    })

    await deleteProxygenDeployments("eps", "eps-repo", "proxygenKey", "kid-123")

    expect(deleteCalls).toBe(0)
  })

  test("does not delete instances when GitHub API call fails", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = vi.fn(() => {
      return Promise.resolve({
        ok: false,
        status: 500,
        text: async () => "server error",
        json: async () => ({state: "unknown"})
      }) as unknown as Promise<Response>
    })

    let deleteCalls = 0
    invokeLambdaMock.mockImplementation(async (_lambda, _dryRun, functionName: string) => {
      if (functionName === "lambda-resources-ProxygenPTLInstanceGet") {
        return JSON.stringify([{name: "eps-pr-999"}])
      }
      if (functionName === "lambda-resources-ProxygenPTLInstanceDelete") {
        deleteCalls++
        return "\"deleted\""
      }
      return "\"ok\""
    })

    await deleteProxygenDeployments("eps", "eps-repo", "proxygenKey", "kid-123")

    expect(deleteCalls).toBe(0)
  })
})
