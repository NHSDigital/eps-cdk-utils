import {Fn} from "aws-cdk-lib"

/** Default prefix used for CDK config environment variables. */
export const CDK_ENV_PREFIX = "CDK_CONFIG_"

/** Imported cross-stack account resource values used by constructs in this package. */
export const ACCOUNT_RESOURCES = {
  CloudwatchEncryptionKMSPolicyArn: Fn.importValue("account-resources-cdk-uk:IAM:CloudwatchEncryptionKMSPolicy:Arn"),
  CloudwatchLogsKmsKeyArn: Fn.importValue("account-resources-cdk-uk:KMS:CloudwatchLogsKmsKey:Arn"),
  EpsDomainName: Fn.importValue("eps-route53-resources:EPS-domain"),
  EpsZoneId: Fn.importValue("eps-route53-resources:EPS-ZoneID"),
  LambdaAccessSecretsPolicy: Fn.importValue("secrets-cdk:IAM:LambdaAccessSecretsPolicy:Arn"),
  LambdaDecryptSecretsKMSPolicy: Fn.importValue("secrets-cdk:IAM:LambdaDecryptSecretsKMSPolicy:Arn"),
  SpinePrivateKeyARN: Fn.importValue("secrets-cdk:Secrets:SpinePrivateKey:Arn"),
  SpinePublicCertificateARN: Fn.importValue("secrets-cdk:Secrets:SpinePublicCertificate:Arn"),
  SpineASIDARN: Fn.importValue("secrets-cdk:Secrets:SpineASID:Arn"),
  SpinePartyKeyARN: Fn.importValue("secrets-cdk:Secrets:SpinePartyKey:Arn"),
  SpineCAChainARN: Fn.importValue("secrets-cdk:Secrets:SpineCAChain:Arn"),
  TrustStoreBucket: Fn.importValue("account-resources-cdk-uk:Bucket:TrustStoreBucket:Arn"),
  TrustStoreBucketKMSKey: Fn.importValue("account-resources-cdk-uk:KMS:TrustStoreBucketKMSKey:Arn"),
  TrustStoreDeploymentBucket: Fn.importValue("account-resources-cdk-uk:Bucket:TrustStoreDeploymentBucket:Arn")
}

/** Imported shared Lambda resource values used by Lambda and API Gateway constructs. */
export const LAMBDA_RESOURCES = {
  LambdaInsightsLogGroupPolicy: Fn.importValue("account-resources-cdk-uk:IAM:LambdaInsightsLogGroupPolicy:Arn"),
  SplunkDeliveryStream: Fn.importValue("account-resources-cdk-uk:Firehose:SplunkDeliveryStream:Arn"),
  SplunkSubscriptionFilterRole: Fn.importValue("account-resources-cdk-uk:IAM:SplunkSubscriptionFilterRole:Arn")
}

/** Shared cfn-guard rule identifiers used for metadata suppressions. */
export const CFN_GUARD_RULES = {
  LogGroupRetentionPeriodCheck: "CW_LOGGROUP_RETENTION_PERIOD_CHECK"
} as const
