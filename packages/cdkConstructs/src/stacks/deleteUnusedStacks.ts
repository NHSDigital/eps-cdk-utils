import {
  CloudFormationClient,
  DeleteStackCommand,
  ListStacksCommand,
  StackSummary
} from "@aws-sdk/client-cloudformation"
import {ChangeResourceRecordSetsCommand, ListHostedZonesByNameCommand, Route53Client} from "@aws-sdk/client-route-53"

/**
 * Deletes unused CloudFormation stacks and their associated Route 53 CNAME records.
 *
 * A stack is considered unused if it is a superseded version of the base stack
 * (and is not within the 24‑hour embargo window).
 *
 * @param baseStackName - Base name/prefix of the CloudFormation stacks to evaluate.
 * @param hostedZoneName - Hosted zone name used to look up Route 53 records.
 * @param getActiveVersions - Function to get the currently active versions.
 * @returns A promise that resolves when all eligible stacks have been processed.
 */
export async function deleteUnusedMainStacks(
  baseStackName: string,
  hostedZoneName: string,
  getActiveVersions: () => Promise<ActiveVersions>
): Promise<void> {
  const cloudFormationClient = new CloudFormationClient({})
  const route53Client = new Route53Client({})
  const hostedZoneId = await getHostedZoneId(route53Client, hostedZoneName)
  const activeVersions = await getActiveVersions()
  console.log("checking cloudformation stacks")

  const allStacks = await listAllStacks(cloudFormationClient)
  const activeVersionDeployed = allStacks.find(stack => {
    const versionInfo = getVersion(stack.StackName!, baseStackName)
    if (!versionInfo) {
      return false
    }
    const {version, isSandbox} = versionInfo
    return !isSandbox && version === activeVersions.baseEnvVersion?.replaceAll(".", "-")
  })?.CreationTime
  if (isEmbargoed(activeVersionDeployed)) {
    console.log(
      `Active version ${activeVersions.baseEnvVersion} deployed less than 24 hours ago,` +
      "skipping deletion of superseded stacks")
    return
  }

  for (const stack of allStacks) {
    if (stack.StackStatus === "DELETE_COMPLETE" || !stack.StackName) {
      continue
    }

    const stackName = stack.StackName
    if (!isSupersededVersion(stack, baseStackName, activeVersions)) {
      continue
    }

    await deleteStack(cloudFormationClient, route53Client, hostedZoneId, hostedZoneName, stackName)
  }
}

/**
 * Deletes unused CloudFormation stacks and their associated Route 53 CNAME records.
 *
 * A stack is considered unused if it represents a pull request deployment whose PR has been closed.
 *
 * @param baseStackName - Base name/prefix of the CloudFormation stacks to evaluate.
 * @param hostedZoneName - Hosted zone name used to look up Route 53 records.
 * @param repoName - GitHub repository name used to look up pull request state.
 * @returns A promise that resolves when all eligible stacks have been processed.
 */
export async function deleteUnusedPrStacks(
  baseStackName: string,
  hostedZoneName: string,
  repoName: string): Promise<void> {
  const cloudFormationClient = new CloudFormationClient({})
  const route53Client = new Route53Client({})
  const hostedZoneId = await getHostedZoneId(route53Client, hostedZoneName)

  console.log("checking cloudformation stacks")

  const allStacks = await listAllStacks(cloudFormationClient)

  for (const stack of allStacks) {
    if (stack.StackStatus === "DELETE_COMPLETE" || !stack.StackName) {
      continue
    }

    const stackName = stack.StackName
    if (!(await isClosedPullRequest(stackName, baseStackName, repoName))) {
      continue
    }

    await deleteStack(cloudFormationClient, route53Client, hostedZoneId, hostedZoneName, stackName)
  }
}

async function deleteStack(
  cloudFormationClient: CloudFormationClient,
  route53Client: Route53Client,
  hostedZoneId: string | undefined,
  hostedZoneName: string,
  stackName: string
): Promise<void> {
  await cloudFormationClient.send(new DeleteStackCommand({StackName: stackName}))
  console.log("** Sleeping for 60 seconds to avoid 429 on delete stack **")
  await new Promise((resolve) => setTimeout(resolve, 60_000))

  const recordName = `${stackName}.${hostedZoneName}`
  console.log(`** going to delete CNAME record ${recordName} **`)
  await route53Client.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: "DELETE",
            ResourceRecordSet: {
              Name: recordName,
              Type: "CNAME"
            }
          }
        ]
      }
    })
  )

  console.log(`CNAME record ${recordName} deleted`)
}

async function listAllStacks(cloudFormationClient: CloudFormationClient): Promise<Array<StackSummary>> {
  const stacks: Array<StackSummary> = []
  let nextToken: string | undefined

  do {
    const response = await cloudFormationClient.send(new ListStacksCommand({NextToken: nextToken}))

    if (response.StackSummaries) {
      stacks.push(...response.StackSummaries)
    }

    nextToken = response.NextToken
  } while (nextToken)

  return stacks
}

async function getHostedZoneId(route53Client: Route53Client, hostedZoneName: string): Promise<string | undefined> {
  const response = await route53Client.send(
    new ListHostedZonesByNameCommand({
      DNSName: hostedZoneName
    })
  )

  return response.HostedZones?.[0]?.Id
}

async function isClosedPullRequest(stackName: string, baseStackName: string, repoName: string): Promise<boolean> {
  const match = new RegExp(String.raw`^${baseStackName}-pr-(?<pullRequestId>\d+)(-sandbox)?$`).exec(stackName)
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
    console.log(`not going to delete stack ${stackName} as PR state is ${data.state}`)
    return false
  }

  console.log(`** going to delete stack ${stackName} as PR state is ${data.state} **`)
  return true
}

export type ActiveVersions = {
  baseEnvVersion: string
  sandboxEnvVersion: string | null
}

export async function getActiveApiVersions(basePath: string): Promise<ActiveVersions> {
  let apigeeEnv = process.env.APIGEE_ENVIRONMENT!
  const baseEnvVersion = await getActiveApiVersion(apigeeEnv, basePath)
  let sandboxEnvVersion: string | null = null
  try {
    if (apigeeEnv === "int") {
      sandboxEnvVersion = await getActiveApiVersion("sandbox", basePath)
    } else if (apigeeEnv === "internal-dev") {
      sandboxEnvVersion = await getActiveApiVersion("internal-dev-sandbox", basePath)
    }
  } catch (error) {
    console.log(`Failed to get active version for sandbox environment: ${(error as Error).message}`)
  }
  return {baseEnvVersion, sandboxEnvVersion}
}

async function getActiveApiVersion(apimDomain: string, basePath: string): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    apikey: `${process.env.APIM_STATUS_API_KEY}`
  }
  const url = `https://${apimDomain}/${basePath}/_status`
  console.log(`Checking live api status endpoint at ${url} for active version`)
  const response = await fetch(url, {headers})
  if (!response.ok) {
    throw new Error(`Failed to fetch active version from ${url}: ${response.status} ${await response.text()}`)
  }

  const data = (await response.json()) as {checks: {healthcheck: {outcome: {versionNumber: string}}}}
  return data.checks.healthcheck.outcome.versionNumber
}

function getVersion(stackName: string, baseStackName: string): {version: string, isSandbox: boolean} | null {
  const pattern = String.raw`^${baseStackName}(?<sandbox>-sandbox)?-(?<version>[\da-z-]+)?$`
  const match = new RegExp(pattern).exec(stackName)
  if (!match?.groups?.version || match.groups.version.startsWith("pr-")) {
    return null
  }
  return {version: match.groups.version, isSandbox: match.groups.sandbox === "-sandbox"}
}

function isEmbargoed(deployDate: Date | undefined): boolean {
  return !!deployDate && Date.now() - deployDate.getTime() < 24 * 60 * 60 * 1000
}

function isSupersededVersion(
  stack: StackSummary,
  baseStackName: string,
  activeVersions: ActiveVersions
): boolean {
  const versionInfo = getVersion(stack.StackName!, baseStackName)
  if (!versionInfo) {
    return false
  }
  if (isEmbargoed(stack.CreationTime)) {
    console.log(`Stack ${stack.StackName} created less than 24 hours ago, keeping for potential rollback`)
    return false
  }
  const {version, isSandbox} = versionInfo
  const currentVersion = isSandbox ? activeVersions.sandboxEnvVersion : activeVersions.baseEnvVersion
  if (!currentVersion) {
    return false
  }
  return version !== currentVersion.replaceAll(".", "-")
}
