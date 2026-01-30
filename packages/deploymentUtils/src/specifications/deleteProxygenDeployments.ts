import {LambdaClient} from "@aws-sdk/client-lambda"
import {getCFConfigValue, getCloudFormationExports} from "../config"
import {invokeLambda} from "./invokeLambda"

interface ProxygenInstance {
  name: string
}

async function isClosedPullRequest(instanceName: string, apigeeApi: string, repoName: string): Promise<boolean> {
  const match = new RegExp(String.raw`^${apigeeApi}-pr-(?<pullRequestId>\d+)$`).exec(instanceName)
  if (!match?.groups?.pullRequestId) {
    return false
  }

  const pullRequestId = match.groups.pullRequestId
  console.log(`Checking pull request id ${pullRequestId}`)
  const url = `https://api.github.com/repos/NHSDigital/${repoName}/pulls/${pullRequestId}`

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`
  }

  const response = await fetch(url, {headers})
  if (!response.ok) {
    console.log(`Failed to fetch PR ${pullRequestId}: ${response.status} ${await response.text()}`)
    return false
  }

  const data = (await response.json()) as {state?: string}
  if (data.state !== "closed") {
    console.log(`not going to delete instance ${instanceName} as PR state is ${data.state}`)
    return false
  }

  console.log(`** going to delete instance ${instanceName} as PR state is ${data.state} **`)
  return true
}

async function deleteEnvProxygenDeployments(
  apigeeEnvironment: string,
  apigeeApi: string,
  repoName: string,
  proxygenPrivateKeyName: string,
  proxygenKid: string
): Promise<void> {
  const lambda = new LambdaClient({})

  const exports = await getCloudFormationExports()
  const proxygenPrivateKeyArn = getCFConfigValue(exports, `account-resources:${proxygenPrivateKeyName}`)

  console.log(`Checking Apigee deployments of ${apigeeApi} on ${apigeeEnvironment}`)
  const instances = JSON.parse(await invokeLambda(
    lambda,
    false,
    "lambda-resources-ProxygenPTLInstanceGet",
    {
      apiName: apigeeApi,
      environment: apigeeEnvironment,
      kid: proxygenKid,
      proxygenSecretName: proxygenPrivateKeyArn
    }
  )) as Array<ProxygenInstance>

  for (const instance of instances) {
    const name = instance.name

    if (!(await isClosedPullRequest(name, apigeeApi, repoName))) {
      continue
    }

    await invokeLambda(
      lambda,
      false,
      "lambda-resources-ProxygenPTLInstanceDelete",
      {
        apiName: apigeeApi,
        environment: apigeeEnvironment,
        instance: name,
        kid: proxygenKid,
        proxygenSecretName: proxygenPrivateKeyArn
      }
    )
  }
}

/**
 * Deletes Proxygen PTL deployments for closed pull requests across internal-dev and internal-dev-sandbox.
 *
 * For each supported Apigee environment, this function queries existing Proxygen instances
 * for the given API and deletes those whose instance name corresponds to a closed GitHub PR
 * in the specified repository.
 *
 * @param apigeeApi - The Apigee API name whose Proxygen deployments should be cleaned up.
 * @param repoName - The GitHub repository name used to look up pull request state.
 * @param proxygenPrivateKeyName - The CloudFormation export key for the Proxygen private key secret.
 * @param proxygenKid - The key ID (kid) used when invoking the Proxygen Lambda functions.
 * @returns A promise that resolves when all eligible deployments have been processed.
 */
export async function deleteProxygenDeployments(
  apigeeApi: string,
  repoName: string,
  proxygenPrivateKeyName: string,
  proxygenKid: string
): Promise<void> {
  await deleteEnvProxygenDeployments(
    "internal-dev",
    apigeeApi,
    repoName,
    proxygenPrivateKeyName,
    proxygenKid
  )
  await deleteEnvProxygenDeployments(
    "internal-dev-sandbox",
    apigeeApi,
    repoName,
    proxygenPrivateKeyName,
    proxygenKid
  )
}
