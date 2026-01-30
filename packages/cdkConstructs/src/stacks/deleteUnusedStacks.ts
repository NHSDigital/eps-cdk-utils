import {
  CloudFormationClient,
  DeleteStackCommand,
  ListStacksCommand,
  StackSummary
} from "@aws-sdk/client-cloudformation"
import {ChangeResourceRecordSetsCommand, ListHostedZonesByNameCommand, Route53Client} from "@aws-sdk/client-route-53"

const CNAME_HOSTED_ZONE_NAME = "dev.eps.national.nhs.uk."

/**
 * Deletes unused CloudFormation stacks and their associated Route 53 CNAME records.
 *
 * A stack is considered unused if:
 * - it represents a pull request deployment whose PR has been closed; or
 * - it is a superseded version of the base stack (and is not within the 24‑hour embargo window).
 *
 * @param baseStackName - Base name/prefix of the CloudFormation stacks to evaluate.
 * @param repoName - GitHub repository name used to look up pull request state.
 * @param basePath - Base path of the API used to determine the currently active version.
 * @returns A promise that resolves when all eligible stacks have been processed.
 */
export async function deleteUnusedStacks(baseStackName: string, repoName: string, basePath: string): Promise<void> {
  const cloudFormationClient = new CloudFormationClient({})
  const route53Client = new Route53Client({})
  const hostedZoneId = await getHostedZoneId(route53Client)
  const activeVersions = await getActiveVersions(basePath)

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
  const keepAllNonPRStacks = isEmbargoed(activeVersionDeployed)

  for (const stack of allStacks) {
    if (stack.StackStatus === "DELETE_COMPLETE" || !stack.StackName) {
      continue
    }

    const stackName = stack.StackName
    const deleteSuperseded = !keepAllNonPRStacks && isSupersededVersion(stack, baseStackName, activeVersions)
    if (!deleteSuperseded && !(await isClosedPullRequest(stackName, baseStackName, repoName))) {
      continue
    }

    await cloudFormationClient.send(new DeleteStackCommand({StackName: stackName}))
    console.log("** Sleeping for 60 seconds to avoid 429 on delete stack **")
    await new Promise((resolve) => setTimeout(resolve, 60_000))

    const recordName = `${stackName}.${CNAME_HOSTED_ZONE_NAME}`
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

async function getHostedZoneId(route53Client: Route53Client): Promise<string | undefined> {
  const response = await route53Client.send(
    new ListHostedZonesByNameCommand({
      DNSName: CNAME_HOSTED_ZONE_NAME
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

type ActiveVersions = {
  baseEnvVersion: string
  sandboxEnvVersion: string | null
}

async function getActiveVersions(basePath: string): Promise<ActiveVersions> {
  let apigeeEnv = process.env.APIGEE_ENVIRONMENT!
  const baseEnvVersion = await getActiveVersion(apigeeEnv, basePath)
  let sandboxEnvVersion: string | null = null
  try {
    if (apigeeEnv === "int") {
      sandboxEnvVersion = await getActiveVersion("sandbox", basePath)
    } else if (apigeeEnv === "internal-dev") {
      sandboxEnvVersion = await getActiveVersion("internal-dev-sandbox", basePath)
    }
  } catch (error) {
    console.log(`Failed to get active version for sandbox environment: ${(error as Error).message}`)
  }
  return {baseEnvVersion, sandboxEnvVersion}
}

async function getActiveVersion(apimDomain: string, basePath: string): Promise<string> {
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
  const pattern = String.raw`^${baseStackName}(?<sandbox>-sandbox)?-(?<version>v[\da-z-]+)?$`
  const match = new RegExp(pattern).exec(stackName)
  if (!match?.groups?.version) {
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
