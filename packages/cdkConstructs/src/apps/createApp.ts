import {
  App,
  Aspects,
  Tags,
  StackProps
} from "aws-cdk-lib"
import {AwsSolutionsChecks} from "cdk-nag"
import {getConfigFromEnvVar, getBooleanConfigFromEnvVar, calculateVersionedStackName} from "../config"

export interface StandardStackProps extends StackProps {
  readonly stackName: string
  readonly version: string
  readonly commitId: string
  readonly isPullRequest: boolean
}

export function createApp(
  appName: string,
  repoName: string,
  driftDetectionGroup: string,
  isStateless: boolean = true,
  region: string = "eu-west-2"
): {app: App, props: StandardStackProps} {
  let stackName = getConfigFromEnvVar("stackName")
  const versionNumber = getConfigFromEnvVar("versionNumber")
  const commitId = getConfigFromEnvVar("commitId")
  const isPullRequest = getBooleanConfigFromEnvVar("isPullRequest")
  let cfnDriftDetectionGroup = driftDetectionGroup
  if (isPullRequest) {
    cfnDriftDetectionGroup += "-pull-request"
  }

  const app = new App()

  Aspects.of(app).add(new AwsSolutionsChecks({verbose: true}))

  Tags.of(app).add("version", versionNumber)
  Tags.of(app).add("commit", commitId)
  Tags.of(app).add("stackName", stackName)
  Tags.of(app).add("cdkApp", appName)
  Tags.of(app).add("repo", repoName)
  Tags.of(app).add("cfnDriftDetectionGroup", cfnDriftDetectionGroup)

  if (isStateless && !isPullRequest) {
    stackName = calculateVersionedStackName(stackName, versionNumber)
  }

  return {
    app,
    props: {
      env: {
        region
      },
      stackName,
      version: versionNumber,
      commitId,
      isPullRequest
    }
  }
}
