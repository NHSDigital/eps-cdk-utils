import {
  beforeEach,
  describe,
  expect,
  test,
  vi
} from "vitest"
import {deployApi} from "../../src/specifications/deployApi"

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
    constructor() {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send(command: any) {
      return lambdaSendMock(command)
    }
  }

  return {LambdaClient, InvokeCommand}
})

const getCloudFormationExportsMock = vi.fn()

vi.mock("../../src/config", () => ({
  getCloudFormationExports: () => getCloudFormationExportsMock(),
  getCFConfigValue: (exports: Record<string, string>, name: string) => exports[name]
}))

function createSpec() {
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
      securitySchemes: {
        "nhs-cis2-aal3": {}
      }
    },
    servers: []
  }
}

const defaultExportsMap = {
  "account-resources:clientCert": "arn:client-cert",
  "account-resources:clientKey": "arn:client-key",
  "account-resources:proxygenKey": "arn:proxygen-key"
}

describe("deployApi", () => {
  beforeEach(() => {
    lambdaSendMock.mockReset().mockResolvedValue({Payload: Buffer.from('"ok"')})
    getCloudFormationExportsMock.mockReset()
  })

  function payloadFromCall(callIndex: number) {
    const command = lambdaSendMock.mock.calls[callIndex][0] as {input: {Payload: Buffer}}
    return JSON.parse(command.input.Payload.toString())
  }

  function functionNameFromCall(callIndex: number) {
    const command = lambdaSendMock.mock.calls[callIndex][0] as {input: {FunctionName: string}}
    return command.input.FunctionName
  }

  test("stores secrets, deploys instance and publishes spec for internal-dev", async () => {
    const spec = JSON.stringify(createSpec())
    getCloudFormationExportsMock.mockResolvedValue(defaultExportsMap)

    await deployApi(
      spec,
      "eps",
      "2.0.0",
      "internal-dev",
      false,
      "nonprod",
      "eps-stack-001",
      "mtls/secret",
      "clientCert",
      "clientKey",
      "proxygenKey",
      "kid-123",
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
    expect(instancePayload.specDefinition.info.version).toBe("2.0.0")
    expect(instancePayload.specDefinition["x-nhsd-apim"].target.security.secret).toBe("mtls/secret")
    expect(instancePayload.specDefinition["x-nhsd-apim"].target.url)
      .toBe("https://eps-stack-001.nonprod.eps.national.nhs.uk")
    expect(instancePayload.specDefinition.components.securitySchemes["nhs-cis2-aal3"].$ref)
      .toBe("https://proxygen.ptl.api.platform.nhs.uk/components/securitySchemes/nhs-cis2-aal3")
    expect(instancePayload.specDefinition.servers[0].url)
      .toBe("https://internal-dev.api.service.nhs.uk/eps")

    expect(functionNameFromCall(2)).toBe("lambda-resources-ProxygenPTLSpecPublish")
    const publishPayload = payloadFromCall(2)
    expect(publishPayload.environment).toBe("uat")
    expect(publishPayload.specDefinition.servers[0].url)
      .toBe("https://internal-dev-sandbox.api.service.nhs.uk/eps")
  })

  test("handles pull requests in sandbox without storing secrets", async () => {
    const spec = JSON.stringify(createSpec())
    getCloudFormationExportsMock.mockResolvedValue(defaultExportsMap)

    await deployApi(
      spec,
      "eps",
      "3.1.4",
      "sandbox",
      true,
      "nonprod",
      "eps-pr-stack-456",
      "mtls/secret",
      "clientCert",
      "clientKey",
      "proxygenKey",
      "kid-789",
      false
    )

    expect(lambdaSendMock).toHaveBeenCalledTimes(1)
    expect(functionNameFromCall(0)).toBe("lambda-resources-ProxygenProdInstancePut")

    const instancePayload = payloadFromCall(0)
    expect(instancePayload.instance).toBe("eps-pr-456")
    expect(instancePayload.specDefinition.info.title).toBe("[PR-456] EPS API")
    expect(instancePayload.specDefinition["x-nhsd-apim"].monitoring).toBe(false)
    expect(instancePayload.specDefinition["x-nhsd-apim"].target.security.secret).toBeUndefined()
    expect(instancePayload.specDefinition["x-nhsd-apim"]["target-attributes"]).toBeUndefined()
    expect(instancePayload.specDefinition.servers[0].url)
      .toBe("https://sandbox.api.service.nhs.uk/eps-pr-456")
  })

  test("uses prod lambdas and prod security scheme refs", async () => {
    const spec = JSON.stringify(createSpec())
    getCloudFormationExportsMock.mockResolvedValue(defaultExportsMap)

    await deployApi(
      spec,
      "eps",
      "4.0.0",
      "prod",
      false,
      "prod",
      "eps-prod-stack",
      "mtls/secret",
      "clientCert",
      "clientKey",
      "proxygenKey",
      "kid-prod",
      false
    )

    expect(lambdaSendMock).toHaveBeenCalledTimes(2)
    expect(functionNameFromCall(0)).toBe("lambda-resources-ProxygenProdMTLSSecretPut")
    expect(functionNameFromCall(1)).toBe("lambda-resources-ProxygenProdInstancePut")

    const specPayload = payloadFromCall(1)
    expect(specPayload.specDefinition.servers[0].url)
      .toBe("https://api.service.nhs.uk/eps")
    expect(specPayload.specDefinition.components.securitySchemes["nhs-cis2-aal3"].$ref)
      .toBe("https://proxygen.prod.api.platform.nhs.uk/components/securitySchemes/nhs-cis2-aal3")
  })

  test("publishes spec to prod catalogue for int environment", async () => {
    const spec = JSON.stringify(createSpec())
    getCloudFormationExportsMock.mockResolvedValue(defaultExportsMap)

    await deployApi(
      spec,
      "eps",
      "5.0.0",
      "int",
      false,
      "nonprod",
      "eps-int-stack",
      "mtls/secret",
      "clientCert",
      "clientKey",
      "proxygenKey",
      "kid-int",
      false
    )

    expect(lambdaSendMock).toHaveBeenCalledTimes(3)
    expect(functionNameFromCall(2)).toBe("lambda-resources-ProxygenProdSpecPublish")
    const publishPayload = payloadFromCall(2)
    expect(publishPayload.environment).toBe("prod")
    expect(publishPayload.specDefinition.servers[0].url)
      .toBe("https://sandbox.api.service.nhs.uk/eps")
  })

  test("dry run only logs intended invocations", async () => {
    const spec = JSON.stringify(createSpec())
    getCloudFormationExportsMock.mockResolvedValue(defaultExportsMap)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)

    await deployApi(
      spec,
      "eps",
      "1.0.0",
      "int",
      false,
      "nonprod",
      "eps-int-stack",
      "mtls/secret",
      "clientCert",
      "clientKey",
      "proxygenKey",
      "kid-int",
      true
    )

    expect(lambdaSendMock).not.toHaveBeenCalled()
    expect(logSpy.mock.calls.some(([message]) =>
      typeof message === "string" && message.includes("Would invoke lambda lambda-resources-ProxygenProdMTLSSecretPut")
    )).toBe(true)
    logSpy.mockRestore()
  })

  test("throws when lambda invocation returns a FunctionError", async () => {
    const spec = JSON.stringify(createSpec())
    getCloudFormationExportsMock.mockResolvedValue(defaultExportsMap)
    lambdaSendMock
      .mockResolvedValueOnce({FunctionError: "Handled", Payload: Buffer.from('"bad"')})

    await expect(deployApi(
      spec,
      "eps",
      "1.2.3",
      "int",
      false,
      "nonprod",
      "eps-stack",
      "mtls/secret",
      "clientCert",
      "clientKey",
      "proxygenKey",
      "kid",
      false
    )).rejects.toThrow("Error calling lambda lambda-resources-ProxygenProdMTLSSecretPut: \"bad\"")
  })
})
