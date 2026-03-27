import {Fn} from "aws-cdk-lib"

/** Imported cross-stack account resource values used by constructs in this package. */
export const ACCOUNT_RESOURCES = {
  CloudwatchEncryptionKMSPolicyArn: Fn.importValue("account-resources:CloudwatchEncryptionKMSPolicyArn"),
  CloudwatchLogsKmsKeyArn: Fn.importValue("account-resources:CloudwatchLogsKmsKeyArn"),
  EpsDomainName: Fn.importValue("eps-route53-resources:EPS-domain"),
  EpsZoneId: Fn.importValue("eps-route53-resources:EPS-ZoneID"),
  TrustStoreBucket: Fn.importValue("account-resources:TrustStoreBucket"),
  TrustStoreBucketKMSKey: Fn.importValue("account-resources:TrustStoreBucketKMSKey"),
  TrustStoreDeploymentBucket: Fn.importValue("account-resources:TrustStoreDeploymentBucket")
}

/** Imported shared Lambda resource values used by Lambda and API Gateway constructs. */
export const LAMBDA_RESOURCES = {
  LambdaInsightsLogGroupPolicy: Fn.importValue("lambda-resources:LambdaInsightsLogGroupPolicy"),
  SplunkDeliveryStream: Fn.importValue("lambda-resources:SplunkDeliveryStream"),
  SplunkSubscriptionFilterRole: Fn.importValue("lambda-resources:SplunkSubscriptionFilterRole")
}
