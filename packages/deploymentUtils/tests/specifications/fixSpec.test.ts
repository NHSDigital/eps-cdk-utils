import {describe, expect, test} from "vitest"
import {fixSpec} from "../../src/specifications/fixSpec"

type SpecOverrides = {
  securitySchemes?: Record<string, unknown>,
  paths?: Record<string, unknown>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createSpec(overrides: SpecOverrides = {}): any {
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

describe("fixSpec", () => {
  test("sets version, mtls secret, target url and PTL refs for internal-dev", () => {
    const spec = createSpec()

    const instance = fixSpec({
      spec,
      apiName: "eps",
      version: "2.0.0",
      apigeeEnvironment: "internal-dev",
      isPullRequest: false,
      awsEnvironment: "dev",
      stackName: "eps-stack",
      mtlsSecretName: "mtls/secret",
      blueGreen: true
    })

    expect(instance).toBe("eps")
    expect(spec.info.version).toBe("2.0.0")
    expect(spec["x-nhsd-apim"].target.security.secret).toBe("mtls/secret")
    expect(spec["x-nhsd-apim"].target.url)
      .toBe("https://eps-stack-2-0-0.dev.eps.national.nhs.uk")
    expect(spec.components.securitySchemes["nhs-cis2-aal3"].$ref)
      .toBe("https://proxygen.ptl.api.platform.nhs.uk/components/securitySchemes/nhs-cis2-aal3")
    expect(spec.servers[0].url)
      .toBe("https://internal-dev.api.service.nhs.uk/eps")
  })

  test("handles pull request sandbox specs and removes sandbox-only fields", () => {
    const spec = createSpec()

    const instance = fixSpec({
      spec,
      apiName: "eps",
      version: "3.1.4",
      apigeeEnvironment: "sandbox",
      isPullRequest: true,
      awsEnvironment: "int",
      stackName: "eps-pr-stack-456",
      mtlsSecretName: "mtls/secret",
      blueGreen: true
    })

    expect(instance).toBe("eps-pr-456")
    expect(spec.info.title).toBe("[PR-456] EPS API")
    expect(spec["x-nhsd-apim"].monitoring).toBe(false)
    expect(spec["x-nhsd-apim"]["target-attributes"]).toBeUndefined()
    expect(spec.servers[0].url)
      .toBe("https://sandbox.api.service.nhs.uk/eps-pr-456")
  })

  test("replaces all supported security scheme refs and sets prod server url for prod", () => {
    const spec = createSpec({
      securitySchemes: {
        "nhs-cis2-aal3": {},
        "nhs-login-p9": {},
        "app-level3": {},
        "app-level0": {}
      }
    })

    const instance = fixSpec({
      spec,
      apiName: "eps",
      version: "4.0.0",
      apigeeEnvironment: "prod",
      isPullRequest: false,
      awsEnvironment: "prod",
      stackName: "eps-prod-stack",
      mtlsSecretName: "mtls/secret",
      blueGreen: true
    })

    expect(instance).toBe("eps")
    expect(spec.servers[0].url).toBe("https://api.service.nhs.uk/eps")

    const schemes = [
      "nhs-cis2-aal3",
      "nhs-login-p9",
      "app-level3",
      "app-level0"
    ]
    for (const scheme of schemes) {
      expect(spec.components.securitySchemes[scheme].$ref)
        .toBe(`https://proxygen.prod.api.platform.nhs.uk/components/securitySchemes/${scheme}`)
    }
  })

  test("does not version stack name when blueGreen is false", () => {
    const spec = createSpec()

    const instance = fixSpec({
      spec,
      apiName: "eps",
      version: "1.2.3",
      apigeeEnvironment: "internal-dev",
      isPullRequest: false,
      awsEnvironment: "dev",
      stackName: "eps-stack",
      mtlsSecretName: "mtls/secret",
      blueGreen: false
    })

    expect(instance).toBe("eps")
    expect(spec["x-nhsd-apim"].target.url)
      .toBe("https://eps-stack.dev.eps.national.nhs.uk")
  })
})
