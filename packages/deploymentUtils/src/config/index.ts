import {CloudFormationClient, ListExportsCommand} from "@aws-sdk/client-cloudformation"

export function getConfigFromEnvVar(varName: string): string {
  const value = process.env[varName]
  if (!value) {
    throw new Error(`Environment variable ${varName} is not set`)
  }
  return value
}

export function getBooleanConfigFromEnvVar(varName: string): boolean {
  const value = getConfigFromEnvVar(varName)
  return value.toLowerCase() === "true"
}

export function getNumberConfigFromEnvVar(varName: string): number {
  const value = getConfigFromEnvVar(varName)
  return Number(value)
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

export function calculateVersionedStackName(baseStackName: string, version: string): string {
  return `${baseStackName}-${version.replaceAll(".", "-")}`
}
