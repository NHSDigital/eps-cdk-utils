import {CloudFormationClient, ListExportsCommand, DescribeStacksCommand} from "@aws-sdk/client-cloudformation"
import {S3Client, HeadObjectCommand} from "@aws-sdk/client-s3"

export function getConfigFromEnvVar(varName: string, prefix: string = "CDK_CONFIG_"): string {
  const value = process.env[prefix + varName]
  if (!value) {
    throw new Error(`Environment variable ${prefix}${varName} is not set`)
  }
  return value
}

export function getBooleanConfigFromEnvVar(varName: string, prefix: string = "CDK_CONFIG_"): boolean {
  const value = getConfigFromEnvVar(varName, prefix)
  return value.toLowerCase() === "true"
}

export function getNumberConfigFromEnvVar(varName: string, prefix: string = "CDK_CONFIG_"): number {
  const value = getConfigFromEnvVar(varName, prefix)
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

export async function getCloudFormationExports(region: string = "eu-west-2"): Promise<Record<string, string>> {
  const cfnClient = new CloudFormationClient({region})
  const listExportsCommand = new ListExportsCommand({})
  const exports: Record<string, string> = {}
  let nextToken: string | undefined = undefined

  do {
    const response = await cfnClient.send(listExportsCommand)
    response.Exports?.forEach((exp) => {
      if (exp.Name && exp.Value) {
        exports[exp.Name] = exp.Value
      }
    })
    nextToken = response.NextToken
    listExportsCommand.input.NextToken = nextToken
  } while (nextToken)

  return exports
}

export function getCFConfigValue(exports: Record<string, string>, exportName: string): string {
  const value = exports[exportName]
  if (!value) {
    throw new Error(`CloudFormation export ${exportName} not found`)
  }
  return value
}

export function getBooleanCFConfigValue(exports: Record<string, string>, exportName: string): boolean {
  const value = getCFConfigValue(exports, exportName)
  return value.toLowerCase() === "true"
}
