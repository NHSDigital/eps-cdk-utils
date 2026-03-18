// see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Lambda-Insights-extension-versions.html
// for latest ARNs
export const LAMBDA_INSIGHTS_LAYER_ARNS = {
  x64: "arn:aws:lambda:eu-west-2:580247275435:layer:LambdaInsightsExtension:64",
  arm64: "arn:aws:lambda:eu-west-2:580247275435:layer:LambdaInsightsExtension-Arm64:31"
} as const
