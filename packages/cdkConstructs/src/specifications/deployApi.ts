
import {LambdaClient, InvokeCommand} from "@aws-sdk/client-lambda"
import {getCFConfigValue, getCloudFormationExports} from "../config"

export type ApiConfig = {
  specification: string
  apiName: string
  version: string
  apigeeEnvironment: string
  isPullRequest: boolean
  awsEnvironment: string
  stackName: string
  mtlsSecretName: string
  clientCertExportName: string
  clientPrivateKeyExportName: string
  proxygenPrivateKeyExportName: string
  proxygenKid: string
}

export async function deployApi(
  {
    specification,
    apiName,
    version,
    apigeeEnvironment,
    isPullRequest,
    awsEnvironment,
    stackName,
    mtlsSecretName,
    clientCertExportName,
    clientPrivateKeyExportName,
    proxygenPrivateKeyExportName,
    proxygenKid
  }: ApiConfig,
  dryRun: boolean
): Promise<void> {
  const lambda = new LambdaClient({})
  async function invokeLambda(functionName: string, payload: unknown): Promise<void> {
    if (dryRun) {
      console.log(`Would invoke lambda ${functionName}`)
      return
    }

    const invokeResult = await lambda.send(new InvokeCommand({
      FunctionName: functionName,
      Payload: Buffer.from(JSON.stringify(payload))
    }))
    const responsePayload = Buffer.from(invokeResult.Payload!).toString()
    if (invokeResult.FunctionError) {
      throw new Error(`Error calling lambda ${functionName}: ${responsePayload}`)
    }
    console.log(`Lambda ${functionName} invoked successfully. Response:`, responsePayload)
  }

  let instance = apiName
  const spec = JSON.parse(specification)
  if (isPullRequest) {
    const pr_id = stackName.split("-").pop()
    instance = `${apiName}-pr-${pr_id}`
    spec.info.title = `[PR-${pr_id}] ${spec.info.title}`
    spec["x-nhsd-apim"].monitoring = false
    delete spec["x-nhsd-apim"].target.security.secret
  } else {
    spec["x-nhsd-apim"].target.security.secret = mtlsSecretName
  }
  spec.info.version = version
  spec["x-nhsd-apim"].target.url = `https://${stackName}.${awsEnvironment}.eps.national.nhs.uk`
  if (apigeeEnvironment === "prod") {
    spec.servers = [ {url: `https://api.service.nhs.uk/${instance}`} ]
    spec.components.securitySchemes["nhs-cis2-aal3"] = {
      "$ref": "https://proxygen.prod.api.platform.nhs.uk/components/securitySchemes/nhs-cis2-aal3"
    }
  } else {
    spec.servers = [ {url: `https://${apigeeEnvironment}.api.service.nhs.uk/${instance}`} ]
    spec.components.securitySchemes["nhs-cis2-aal3"] = {
      "$ref": "https://proxygen.ptl.api.platform.nhs.uk/components/securitySchemes/nhs-cis2-aal3"
    }
  }
  if (apigeeEnvironment.includes("sandbox")) {
    delete spec["x-nhsd-apim"]["target-attributes"] // Resolve issue with sandbox trying to look up app name
  }

  const exports = await getCloudFormationExports()
  const clientCertArn = getCFConfigValue(exports, `account-resources:${clientCertExportName}`)
  const clientPrivateKeyArn = getCFConfigValue(exports, `account-resources:${clientPrivateKeyExportName}`)
  const proxygenPrivateKeyArn = getCFConfigValue(exports, `account-resources:${proxygenPrivateKeyExportName}`)

  let put_secret_lambda = "lambda-resources-ProxygenPTLMTLSSecretPut"
  let instance_put_lambda = "lambda-resources-ProxygenPTLInstancePut"
  let spec_publish_lambda = "lambda-resources-ProxygenPTLSpecPublish"
  if (/^(int|sandbox|prod)$/.test(apigeeEnvironment)) {
    put_secret_lambda = "lambda-resources-ProxygenProdMTLSSecretPut"
    instance_put_lambda = "lambda-resources-ProxygenProdInstancePut"
    spec_publish_lambda = "lambda-resources-ProxygenProdSpecPublish"
  }

  // --- Store the secret used for mutual TLS ---
  if (!isPullRequest) {
    console.log("Store the secret used for mutual TLS to AWS using Proxygen proxy lambda")
    await invokeLambda(put_secret_lambda, {
      apiName,
      environment: apigeeEnvironment,
      secretName: mtlsSecretName,
      secretKeyName: clientPrivateKeyArn,
      secretCertName: clientCertArn,
      kid: proxygenKid,
      proxygenSecretName: proxygenPrivateKeyArn
    })
  }

  // --- Deploy the API instance ---
  console.log("Deploy the API instance using Proxygen proxy lambda")
  await invokeLambda(instance_put_lambda, {
    apiName,
    environment: apigeeEnvironment,
    specDefinition: spec,
    instance,
    kid: proxygenKid,
    proxygenSecretName: proxygenPrivateKeyArn
  })

  // --- Publish the API spec to the catalogue ---
  let spec_publish_env
  if (apigeeEnvironment === "int") {
    console.log("Deploy the API spec to prod catalogue as it is int environment")
    spec.servers = [ {url: `https://sandbox.api.service.nhs.uk/${instance}`} ]
    spec_publish_env = "prod"
  } else if (apigeeEnvironment === "internal-dev" && !isPullRequest) {
    console.log("Deploy the API spec to uat catalogue as it is internal-dev environment")
    spec.servers = [ {url: `https://internal-dev-sandbox.api.service.nhs.uk/${instance}`} ]
    spec_publish_env = "uat"
  }
  if (spec_publish_env) {
    await invokeLambda(spec_publish_lambda, {
      apiName,
      environment: spec_publish_env,
      specDefinition: spec,
      instance,
      kid: proxygenKid,
      proxygenSecretName: proxygenPrivateKeyArn
    })
  }
}
