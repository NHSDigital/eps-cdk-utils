import {LambdaClient} from "@aws-sdk/client-lambda"
import {getCFConfigValue, getCloudFormationExports} from "../config/index"
import {fixSpec} from "./fixSpec"
import {invokeLambda} from "./invokeLambda"

export type ApiConfig = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spec: any
  apiName: string
  version: string
  apigeeEnvironment: string
  isPullRequest: boolean
  awsEnvironment: string
  stackName: string
  mtlsSecretName: string
  clientCert: string
  clientPrivateKey: string
  proxygenPrivateKeyExportName: string
  proxygenKid: string
  hiddenPaths: Array<string>
}

export async function deployApi(
  {
    spec,
    apiName,
    version,
    apigeeEnvironment,
    isPullRequest,
    awsEnvironment,
    stackName,
    mtlsSecretName,
    clientCert,
    clientPrivateKey,
    proxygenPrivateKeyExportName,
    proxygenKid,
    hiddenPaths
  }: ApiConfig,
  blueGreen: boolean,
  dryRun: boolean
): Promise<void> {
  const lambda = new LambdaClient({})
  const instance = fixSpec({
    spec,
    apiName,
    version,
    apigeeEnvironment,
    isPullRequest,
    awsEnvironment,
    stackName,
    mtlsSecretName,
    blueGreen
  })

  const exports = await getCloudFormationExports()
  const proxygenPrivateKeyArn = getCFConfigValue(exports, `account-resources:${proxygenPrivateKeyExportName}`)

  let put_secret_lambda = "lambda-resources-ProxygenPTLMTLSSecretPut"
  let instance_put_lambda = "lambda-resources-ProxygenPTLInstancePut"
  let spec_publish_lambda = "lambda-resources-ProxygenPTLSpecPublish"
  if (/^(int|sandbox|prod)$/.test(apigeeEnvironment)) {
    put_secret_lambda = "lambda-resources-ProxygenProdMTLSSecretPut"
    instance_put_lambda = "lambda-resources-ProxygenProdInstancePut"
    spec_publish_lambda = "lambda-resources-ProxygenProdSpecPublish"
  }

  if (!isPullRequest) {
    console.log("Store the secret used for mutual TLS to AWS using Proxygen proxy lambda")
    await invokeLambda(
      lambda,
      dryRun,
      put_secret_lambda,
      {
        apiName,
        environment: apigeeEnvironment,
        secretName: mtlsSecretName,
        secretKey: clientPrivateKey,
        secretCert: clientCert,
        kid: proxygenKid,
        proxygenSecretName: proxygenPrivateKeyArn
      }
    )
  }

  console.log("Deploy the API instance using Proxygen proxy lambda")
  await invokeLambda(
    lambda,
    dryRun,
    instance_put_lambda,
    {
      apiName,
      environment: apigeeEnvironment,
      specDefinition: spec,
      instance,
      kid: proxygenKid,
      proxygenSecretName: proxygenPrivateKeyArn
    }
  )

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
    for (const path of hiddenPaths) {
      delete spec.paths[path]
    }
    await invokeLambda(
      lambda,
      dryRun,
      spec_publish_lambda,
      {
        apiName,
        environment: spec_publish_env,
        specDefinition: spec,
        instance,
        kid: proxygenKid,
        proxygenSecretName: proxygenPrivateKeyArn
      }
    )
  }
}
