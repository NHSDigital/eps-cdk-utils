import {calculateVersionedStackName} from "../config/index"

type SpecConfig = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spec: any
  apiName: string
  version: string
  apigeeEnvironment: string
  isPullRequest: boolean
  awsEnvironment: string
  stackName: string
  mtlsSecretName: string
  blueGreen: boolean
}

function replaceSchemeRefs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spec: any,
  domain: string
) {
  const schemes = ["nhs-cis2-aal3", "nhs-login-p9", "app-level3", "app-level0"]
  for (const scheme of schemes) {
    if (spec.components.securitySchemes[scheme]) {
      spec.components.securitySchemes[scheme] = {
        "$ref": `https://${domain}/components/securitySchemes/${scheme}`
      }
    }
  }
}

export function fixSpec({
  spec,
  apiName,
  version,
  apigeeEnvironment,
  isPullRequest,
  awsEnvironment,
  stackName,
  mtlsSecretName,
  blueGreen
}: SpecConfig): string {
  let instance = apiName
  let stack = stackName
  if (isPullRequest) {
    const pr_id = stackName.split("-").pop()
    instance = `${apiName}-pr-${pr_id}`
    spec.info.title = `[PR-${pr_id}] ${spec.info.title}`
    spec["x-nhsd-apim"].monitoring = false
  } else if (blueGreen) {
    stack = calculateVersionedStackName(stackName, version)
  }
  spec.info.version = version
  spec["x-nhsd-apim"].target.url = `https://${stack}.${awsEnvironment}.eps.national.nhs.uk`
  spec["x-nhsd-apim"].target.security.secret = mtlsSecretName
  if (apigeeEnvironment === "prod") {
    spec.servers = [ {url: `https://api.service.nhs.uk/${instance}`} ]
    replaceSchemeRefs(spec, "proxygen.prod.api.platform.nhs.uk")
  } else {
    spec.servers = [ {url: `https://${apigeeEnvironment}.api.service.nhs.uk/${instance}`} ]
    replaceSchemeRefs(spec, "proxygen.ptl.api.platform.nhs.uk")
  }
  if (apigeeEnvironment.includes("sandbox")) {
    delete spec["x-nhsd-apim"]["target-attributes"] // Resolve issue with sandbox trying to look up app name
  }
  return instance
}
