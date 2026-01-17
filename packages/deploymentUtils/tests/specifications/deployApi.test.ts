import {
  beforeEach,
  describe,
  expect,
  test,
  vi
} from "vitest"
import {deployApi} from "../../src/specifications/deployApi"
import type {ApiConfig} from "../../src/specifications/deployApi"

const lambdaSendMock = vi.fn()

vi.mock("@aws-sdk/client-lambda", () => {
  class InvokeCommand {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(input: any) {
      this.input = input
    }
  }

  class LambdaClient {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send(command: any) {
      return lambdaSendMock(command)
    }
  }

  return {LambdaClient, InvokeCommand}
})

const getCloudFormationExportsMock = vi.hoisted(() => vi.fn())

vi.mock("../../src/config/index", async (importOriginal) => {
  const originalModule = await importOriginal<typeof import("../../src/config/index")>()
  return {
    ...originalModule,
    getCloudFormationExports: getCloudFormationExportsMock
  }
})

type SpecOverrides = {
  securitySchemes?: Record<string, unknown>,
  paths?: Record<string, unknown>
}

function createSpec(overrides: SpecOverrides = {}) {
  return {
    info: {title: "EPS API", version: "0.0.1"},
    "x-nhsd-apim": {
      monitoring: true,
      target: {
        url: "",
        security: {secret: "initial"}
      },
      "target-attributes": {app: "eps"}
    },
    components: {
      securitySchemes: overrides.securitySchemes || {"nhs-cis2-aal3": {}}
    },
    paths: overrides.paths || {},
    servers: []
  }
}

const defaultExportsMap = {
  "account-resources:clientCert": "arn:client-cert",
  "account-resources:clientKey": "arn:client-key",
  "account-resources:proxygenKey": "arn:proxygen-key"
}

function buildConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    spec: createSpec(),
    apiName: "eps",
    version: "1.0.0",
    apigeeEnvironment: "internal-dev",
    isPullRequest: false,
    awsEnvironment: "nonprod",
    stackName: "eps-stack-001",
    mtlsSecretName: "mtls/secret",
    clientCertExportName: "clientCert",
    clientPrivateKeyExportName: "clientKey",
    proxygenPrivateKeyExportName: "proxygenKey",
    proxygenKid: "kid-123",
    hiddenPaths: [],
    ...overrides
  }
}

function payloadFromCall(callIndex: number) {
  const command = lambdaSendMock.mock.calls[callIndex][0] as {input: {Payload: Buffer}}
  return JSON.parse(command.input.Payload.toString())
}

function functionNameFromCall(callIndex: number) {
  const command = lambdaSendMock.mock.calls[callIndex][0] as {input: {FunctionName: string}}
  return command.input.FunctionName
}

describe("deployApi", () => {
  beforeEach(() => {
    lambdaSendMock.mockReset().mockResolvedValue({Payload: Buffer.from('"ok"')})
    getCloudFormationExportsMock.mockReset().mockResolvedValue(defaultExportsMap)
  })

  test("stores secrets, deploys instance and publishes spec for internal-dev", async () => {
    await deployApi(
      buildConfig({
        version: "2.0.0",
        apigeeEnvironment: "internal-dev",
        stackName: "eps-stack"
      }),
      true,
      false
    )

    expect(getCloudFormationExportsMock).toHaveBeenCalledTimes(1)
    expect(lambdaSendMock).toHaveBeenCalledTimes(3)

    expect(functionNameFromCall(0)).toBe("lambda-resources-ProxygenPTLMTLSSecretPut")
    const secretPayload = payloadFromCall(0)
    expect(secretPayload).toMatchObject({
      apiName: "eps",
      environment: "internal-dev",
      secretName: "mtls/secret",
      secretKeyName: "arn:client-key",
      secretCertName: "arn:client-cert",
      kid: "kid-123",
      proxygenSecretName: "arn:proxygen-key"
    })

    expect(functionNameFromCall(1)).toBe("lambda-resources-ProxygenPTLInstancePut")
    const instancePayload = payloadFromCall(1)
    expect(instancePayload.instance).toBe("eps")

    expect(functionNameFromCall(2)).toBe("lambda-resources-ProxygenPTLSpecPublish")
    const publishPayload = payloadFromCall(2)
    expect(publishPayload.environment).toBe("uat")
    expect(publishPayload.specDefinition.servers[0].url)
      .toBe("https://internal-dev-sandbox.api.service.nhs.uk/eps")
  })

  test("handles pull requests in sandbox without storing secrets", async () => {
    await deployApi(
      buildConfig({
        version: "3.1.4",
        apigeeEnvironment: "sandbox",
        isPullRequest: true,
        stackName: "eps-pr-stack-456",
        proxygenKid: "kid-789"
      }),
      true,
      false
    )

    expect(lambdaSendMock).toHaveBeenCalledTimes(1)
    expect(functionNameFromCall(0)).toBe("lambda-resources-ProxygenProdInstancePut")

    const instancePayload = payloadFromCall(0)
    expect(instancePayload.instance).toBe("eps-pr-456")
  })

  test("uses prod lambdas for prod environment", async () => {
    await deployApi(
      buildConfig({
        version: "4.0.0",
        apigeeEnvironment: "prod",
        awsEnvironment: "prod",
        stackName: "eps-prod-stack",
        proxygenKid: "kid-prod"
      }),
      true,
      false
    )

    expect(lambdaSendMock).toHaveBeenCalledTimes(2)
    expect(functionNameFromCall(0)).toBe("lambda-resources-ProxygenProdMTLSSecretPut")
    expect(functionNameFromCall(1)).toBe("lambda-resources-ProxygenProdInstancePut")
  })

  test("publishes spec to prod catalogue for int environment", async () => {
    await deployApi(
      buildConfig({
        version: "5.0.0",
        apigeeEnvironment: "int",
        stackName: "eps-int-stack",
        proxygenKid: "kid-int"
      }),
      true,
      false
    )

    expect(lambdaSendMock).toHaveBeenCalledTimes(3)
    expect(functionNameFromCall(2)).toBe("lambda-resources-ProxygenProdSpecPublish")
    const publishPayload = payloadFromCall(2)
    expect(publishPayload.environment).toBe("prod")
    expect(publishPayload.specDefinition.servers[0].url)
      .toBe("https://sandbox.api.service.nhs.uk/eps")
  })

  test("removes hidden paths from published spec", async () => {
    const spec = createSpec({
      paths: {
        "/visible": {get: {}},
        "/hidden": {post: {}}
      }
    })
    await deployApi(
      buildConfig({
        spec,
        apigeeEnvironment: "int",
        stackName: "eps-int-stack",
        proxygenKid: "kid-int",
        hiddenPaths: ["/hidden"]
      }),
      true,
      false
    )
    const publishPayload = payloadFromCall(2)
    expect(publishPayload.specDefinition.paths["/hidden"]).toBeUndefined()
    expect(publishPayload.specDefinition.paths["/visible"]).toBeDefined()
  })

  test("dry run only logs intended invocations", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)

    await deployApi(
      buildConfig({
        apigeeEnvironment: "int",
        stackName: "eps-int-stack",
        proxygenKid: "kid-int"
      }),
      true,
      true
    )

    expect(lambdaSendMock).not.toHaveBeenCalled()
    expect(logSpy.mock.calls.some(([message]) =>
      typeof message === "string" && message.includes("Would invoke lambda lambda-resources-ProxygenProdMTLSSecretPut")
    )).toBe(true)
    logSpy.mockRestore()
  })

  test("throws when lambda invocation returns a FunctionError", async () => {
    lambdaSendMock
      .mockResolvedValueOnce({FunctionError: "Handled", Payload: Buffer.from('"bad"')})

    await expect(deployApi(
      buildConfig({
        version: "1.2.3",
        apigeeEnvironment: "int",
        stackName: "eps-stack"
      }),
      true,
      false
    )).rejects.toThrow("Error calling lambda lambda-resources-ProxygenProdMTLSSecretPut: \"bad\"")
  })
})
