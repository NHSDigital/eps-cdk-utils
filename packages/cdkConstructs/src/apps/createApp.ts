import {
  App,
  Aspects,
  Tags,
  StackProps
} from "aws-cdk-lib"
import {AwsSolutionsChecks} from "cdk-nag"
import {getConfigFromEnvVar, getBooleanConfigFromEnvVar} from "../config"

export interface StandardStackProps extends StackProps {
  /** Semantic version of the deployment (from `versionNumber`). */
  readonly version: string
  /** Git commit identifier baked into the stack. */
  readonly commitId: string
  /** Whether the stack originates from a pull-request environment. */
  readonly isPullRequest: boolean
  /** Logical environment identifier (for example `dev`, `prod`). */
  readonly environment: string
  /** CDK environment configuration used when synthesizing the stack. */
  readonly env: {
    /** AWS region targeted by the stack. */
    readonly region: string
  }
}

export interface CreateAppParams {
  readonly productName: string
  readonly appName: string
  readonly repoName: string
  readonly driftDetectionGroup: string
  readonly region?: string
  readonly projectType?: string
  readonly publicFacing?: string
  readonly serviceCategory?: string
}

/**
 * Initialize a CDK `App` pre-loaded with NHS EPS tags and mandatory configuration.
 *
 * Reads stack metadata from environment variables, and returns
 * both the created `App` instance and the resolved stack props (including version info).
 *
 * @param params - High-level app metadata and optional deployment modifiers.
 * @param params.productName - Product tag value for the stack.
 * @param params.appName - Identifier used for `cdkApp` tagging.
 * @param params.repoName - Repository name stored on the stack tags.
 * @param params.driftDetectionGroup - Baseline drift detection tag (suffixes `-pull-request` when `isPullRequest`).
 * @param params.region - AWS region assigned to the stack environment (default `eu-west-2`).
 * @param params.projectType - Tag describing the project classification (default `Production`).
 * @param params.publicFacing - Public-facing classification tag (default `Y`).
 * @param params.serviceCategory - Service category tag (default `Platinum`).
 * @returns The constructed CDK `App` and the resolved stack props for downstream stacks.
 */
export function createApp({
  productName,
  appName,
  repoName,
  driftDetectionGroup,
  region = "eu-west-2",
  projectType = "Production",
  publicFacing = "Y",
  serviceCategory = "Platinum"
}: CreateAppParams): { app: App, props: StandardStackProps } {
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
  Tags.of(app).add("cdkApp", appName)
  Tags.of(app).add("repo", repoName)
  Tags.of(app).add("cfnDriftDetectionGroup", cfnDriftDetectionGroup)

  return {
    app,
    props: {
      env: {
        region
      },
      version: versionNumber,
      commitId,
      isPullRequest,
      environment
    }
  }
}
