import {CloudFormationClient, DescribeStacksCommand} from "@aws-sdk/client-cloudformation"
import {S3Client, HeadObjectCommand} from "@aws-sdk/client-s3"
import {StandardStackProps} from "../apps/createApp"
import {CDK_ENV_PREFIX} from "../constants"

export function getConfigFromEnvVar(
  varName: string,
  prefix: string = CDK_ENV_PREFIX,
  defaultValue: string | undefined = undefined
): string {
  const value = process.env[prefix + varName]
  if (!value) {
    if (defaultValue !== undefined) {
      return defaultValue
    }
    throw new Error(`Environment variable ${prefix}${varName} is not set`)
  }
  return value
}

export function getBooleanConfigFromEnvVar(
  varName: string,
  prefix: string = CDK_ENV_PREFIX,
  defaultValue: string | undefined = undefined
): boolean {
  const value = getConfigFromEnvVar(varName, prefix, defaultValue)
  return value.toLowerCase().trim() === "true"
}

export function getNumberConfigFromEnvVar(
  varName: string,
  prefix: string = CDK_ENV_PREFIX,
  defaultValue: string | undefined = undefined
): number {
  const value = getConfigFromEnvVar(varName, prefix, defaultValue)
  return Number(value)
}

export async function getTrustStoreVersion(trustStoreFile: string, region: string = "eu-west-2"): Promise<string> {
  const cfnClient = new CloudFormationClient({region})
  const s3Client = new S3Client({region})
  const describeStacksCommand = new DescribeStacksCommand({StackName: "account-resources"})
  const response = await cfnClient.send(describeStacksCommand)
  const trustStoreBucketArn = response.Stacks![0].Outputs!
    .find(output => output.OutputKey === "TrustStoreBucket")!.OutputValue
  const bucketName = trustStoreBucketArn!.split(":")[5]
  const headObjectCommand = new HeadObjectCommand({Bucket: bucketName, Key: trustStoreFile})
  const headObjectResponse = await s3Client.send(headObjectCommand)
  return headObjectResponse.VersionId!
}

export function calculateVersionedStackName(baseStackName: string, props: StandardStackProps): string {
  if (props.isPullRequest) {
    return baseStackName
  }
  return `${baseStackName}-${props.version.replaceAll(".", "-")}`
}

export {LAMBDA_INSIGHTS_LAYER_ARNS} from "./lambdaInsights"
