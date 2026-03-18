import {InvokeCommand, LambdaClient} from "@aws-sdk/client-lambda"

export async function invokeLambda(
  lambda: LambdaClient,
  dryRun: boolean,
  functionName: string,
  payload: unknown
): Promise<string> {
  if (dryRun) {
    console.log(`Would invoke lambda ${functionName}`)
    return "null"
  }
  const invokeResult = await lambda.send(new InvokeCommand({
    FunctionName: functionName,
    Payload: Buffer.from(JSON.stringify(payload))
  }))
  const responsePayload = Buffer.from(invokeResult.Payload!).toString()
  if (invokeResult.FunctionError) {
    throw new Error(`Error calling lambda ${functionName}: ${responsePayload}`)
  }
  console.log(`Lambda ${functionName} invoked successfully. Response:`, responsePayload)
  return responsePayload
}
