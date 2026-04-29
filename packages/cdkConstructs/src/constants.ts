import {Fn} from "aws-cdk-lib"

/** Default prefix used for CDK config environment variables. */
export const CDK_ENV_PREFIX = "CDK_CONFIG_"

/** Imported cross-stack account resource values used by constructs in this package. */
export const ACCOUNT_RESOURCES = {
  CloudwatchEncryptionKMSPolicyArn: Fn.importValue("account-resources-cdk-uk:IAM:CloudwatchEncryptionKMSPolicy:Arn"),
  CloudwatchLogsKmsKeyArn: Fn.importValue("account-resources-cdk-uk:KMS:CloudwatchLogsKmsKey:Arn"),
  TrustStoreBucketArn: Fn.importValue("account-resources-cdk-uk:Bucket:TrustStoreBucket:Arn"),
  TrustStoreBucketKMSKeyArn: Fn.importValue("account-resources-cdk-uk:KMS:TrustStoreBucketKMSKey:Arn"),
  TrustStoreDeploymentBucketArn: Fn.importValue("account-resources-cdk-uk:Bucket:TrustStoreDeploymentBucket:Arn"),
  LambdaInsightsLogGroupPolicyArn: Fn.importValue("account-resources-cdk-uk:IAM:LambdaInsightsLogGroupPolicy:Arn"),
  SplunkDeliveryStreamArn: Fn.importValue("account-resources-cdk-uk:Firehose:SplunkDeliveryStream:Arn"),
  SplunkSubscriptionFilterRoleArn: Fn.importValue("account-resources-cdk-uk:IAM:SplunkSubscriptionFilterRole:Arn")
}

export const ROUTE53_RESOURCES = {
  EpsDomainName: Fn.importValue("eps-route53-resources:EPS-domain"),
  EpsZoneId: Fn.importValue("eps-route53-resources:EPS-ZoneID")
}

export const SECRETS_RESOURCES = {
  LambdaAccessSecretsPolicyArn: Fn.importValue("secrets-cdk:IAM:LambdaAccessSecretsPolicy:Arn"),
  LambdaDecryptSecretsKMSPolicyArn: Fn.importValue("secrets-cdk:IAM:LambdaDecryptSecretsKMSPolicy:Arn"),
  SpinePrivateKeyArn: Fn.importValue("secrets-cdk:Secrets:SpinePrivateKey:Arn"),
  SpinePublicCertificateArn: Fn.importValue("secrets-cdk:Secrets:SpinePublicCertificate:Arn"),
  SpineASIDArn: Fn.importValue("secrets-cdk:Secrets:SpineASID:Arn"),
  SpinePartyKeyArn: Fn.importValue("secrets-cdk:Secrets:SpinePartyKey:Arn"),
  SpineCAChainArn: Fn.importValue("secrets-cdk:Secrets:SpineCAChain:Arn")
}

/** Shared cfn-guard rule identifiers used for metadata suppressions. */
export const CFN_GUARD_RULES = {
  LogGroupRetentionPeriodCheck: "CW_LOGGROUP_RETENTION_PERIOD_CHECK"
} as const
