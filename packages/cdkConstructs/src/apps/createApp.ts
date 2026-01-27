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
  readonly environment: string
}

export function createApp(
  productName: string,
  appName: string,
  repoName: string,
  driftDetectionGroup: string,
  isStateless: boolean = true,
  region: string = "eu-west-2",
  projectType: string = "Production",
  publicFacing: string = "Y",
  serviceCategory: string = "Platinum"
): { app: App, props: StandardStackProps } {
  let stackName = getConfigFromEnvVar("stackName")
  const versionNumber = getConfigFromEnvVar("versionNumber")
  const commitId = getConfigFromEnvVar("commitId")
  const isPullRequest = getBooleanConfigFromEnvVar("isPullRequest")
  const environment = getConfigFromEnvVar("environment")
  let cfnDriftDetectionGroup = driftDetectionGroup
  if (isPullRequest) {
    cfnDriftDetectionGroup += "-pull-request"
  }

  const app = new App()

  Aspects.of(app).add(new AwsSolutionsChecks({verbose: true}))

  Tags.of(app).add("TagVersion", "1")
  Tags.of(app).add("Programme", "EPS")
  Tags.of(app).add("Product", productName)
  Tags.of(app).add("EPS", productName)
  Tags.of(app).add("Owner", "england.epssupport@nhs.net")
  Tags.of(app).add("CostCentre", "128997")
  Tags.of(app).add("Customer", "NHS England")
  Tags.of(app).add("data_classification", "5")
  Tags.of(app).add("DataType", "PII")
  Tags.of(app).add("Environment", environment)
  Tags.of(app).add("ProjectType", projectType)
  Tags.of(app).add("PublicFacing", publicFacing)
  Tags.of(app).add("ServiceCategory", serviceCategory)
  Tags.of(app).add("OnOffPattern", "AlwaysOn")
  Tags.of(app).add("DeploymentTool", "CDK")
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
