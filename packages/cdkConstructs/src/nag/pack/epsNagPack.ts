import {NagMessageLevel, NagPack, NagPackProps} from "cdk-nag"
import {IConstruct} from "constructs"
import {CfnResource} from "aws-cdk-lib"
import {ApiGatewayMutualTls, APIGWStructuredLogging} from "../rules"
import {LambdaFunctionPublicAccessProhibited} from "cdk-nag/lib/rules/lambda"
import {CloudWatchLogGroupEncrypted} from "cdk-nag/lib/rules/cloudwatch"
import {ALBHttpDropInvalidHeaderEnabled, ELBLoggingEnabled, ELBTlsHttpsListenersOnly} from "cdk-nag/lib/rules/elb"
import {APIGWAccessLogging} from "cdk-nag/lib/rules/apigw"
import {
  IAMNoInlinePolicy,
  IAMPolicyNoStatementsWithAdminAccess,
  IAMPolicyNoStatementsWithFullAccess
} from "cdk-nag/lib/rules/iam"
import {S3BucketPublicReadProhibited, S3BucketPublicWriteProhibited, S3DefaultEncryptionKMS} from "cdk-nag/lib/rules/s3"
import {SecretsManagerUsingKMSKey} from "cdk-nag/lib/rules/secretsmanager"
import {SNSEncryptedKMS} from "cdk-nag/lib/rules/sns"
import {VPCDefaultSecurityGroupClosed, VPCFlowLogsEnabled} from "cdk-nag/lib/rules/vpc"
import {WAFv2LoggingEnabled} from "cdk-nag/lib/rules/waf"

// Nag pack implementing EPS specific rules
// It implements API gateway must have mutual TLS enabled
// and rules from https://github.com/cdklabs/cdk-nag/blob/main/RULES.md that are not in aws-solutions pack

export class EpsNagPack extends NagPack {
  constructor(props?: NagPackProps) {
    super(props)
    this.packName = "EpsNagPack"
  }

  public visit(node: IConstruct): void {
    if (node instanceof CfnResource) {
      this.applyRule({
        ruleSuffixOverride: "EPS1",
        info: "API Gateway must does not use mutual TLS.",
        explanation: "All non pull request deployments must enforce mutual TLS on api gateways.",
        level: NagMessageLevel.ERROR,
        rule: ApiGatewayMutualTls,
        node: node
      })
      this.applyRule({
        ruleSuffixOverride: "EPS2",
        info: "The Lambda function permission grants public access.",
        explanation:
        "Public access allows anyone on the internet to perform unauthenticated actions on the function.",
        level: NagMessageLevel.ERROR,
        rule: LambdaFunctionPublicAccessProhibited,
        node: node
      })
      this.applyRule({
        ruleSuffixOverride: "EPS3",
        info: "The CloudWatch Log Group is not encrypted with an AWS KMS key.",
        explanation:
        "To help protect sensitive data at rest, ensure encryption is enabled for your Amazon CloudWatch Log Groups.",
        level: NagMessageLevel.ERROR,
        rule: CloudWatchLogGroupEncrypted,
        node: node
      })
      this.applyRule({
        ruleSuffixOverride: "EPS4",
        info: "The ALB does not have invalid HTTP header dropping enabled.",
        explanation:
        "Ensure that your Application Load Balancers (ALB) are configured to drop http headers.",
        level: NagMessageLevel.ERROR,
        rule: ALBHttpDropInvalidHeaderEnabled,
        node: node
      })
      this.applyRule({
        ruleSuffixOverride: "EPS5",
        info: "The WAFv2 web ACL does not have logging enabled.",
        explanation:
        // eslint-disable-next-line max-len
        "AWS WAF logging provides detailed information about the traffic that is analyzed by your web ACL. The logs record the time that AWS WAF received the request from your AWS resource, information about the request, and an action for the rule that each request matched.",
        level: NagMessageLevel.ERROR,
        rule: WAFv2LoggingEnabled,
        node: node
      })

      this.applyRule({
        ruleSuffixOverride: "EPS6",
        info: "The API does not have access logging enabled.",
        explanation:
        "Enabling access logs helps operators view who accessed an API and how the caller accessed the API.",
        level: NagMessageLevel.ERROR,
        rule: APIGWAccessLogging,
        node: node
      })
      this.applyRule({
        ruleSuffixOverride: "EPS7",
        info: "The API Gateway logs are not configured for the JSON format.",
        explanation:
        "JSON Structured logging makes it easier to derive queries to answer questions about your application.",
        level: NagMessageLevel.ERROR,
        rule: APIGWStructuredLogging,
        node: node
      })
      this.applyRule({
        ruleSuffixOverride: "EPS8",
        info: "The ELB does not have access logs enabled.",
        explanation:
        "Access logs allow operators to analyze traffic patterns and identify and troubleshoot security issues.",
        level: NagMessageLevel.ERROR,
        rule: ELBLoggingEnabled,
        node: node
      })
      this.applyRule({
        ruleSuffixOverride: "EPS9",
        info: "The ELB listener is not configured for secure (HTTPs or SSL) protocols for client communication.",
        explanation:
        // eslint-disable-next-line max-len
        "The SSL protocols enable secure communication by encrypting the communication between the client and the load balancer.",
        level: NagMessageLevel.ERROR,
        rule: ELBTlsHttpsListenersOnly,
        node: node
      })
      this.applyRule({
        ruleSuffixOverride: "EPS10",
        info: "The IAM Group, User, or Role contains an inline policy.",
        explanation:
        // eslint-disable-next-line max-len
        "AWS recommends to use managed policies instead of inline policies. The managed policies allow reusability, versioning and rolling back, and delegating permissions management.",
        level: NagMessageLevel.ERROR,
        rule: IAMNoInlinePolicy,
        node: node
      })
      this.applyRule({
        ruleSuffixOverride: "EPS11",
        // eslint-disable-next-line max-len
        info: "The IAM policy grants admin access, meaning the policy allows a principal to perform all actions on all resources.",
        explanation:
        // eslint-disable-next-line max-len
        'AWS Identity and Access Management (IAM) can help you incorporate the principles of least privilege and separation of duties with access permissions and authorizations, restricting policies from containing "Effect": "Allow" with "Action": "*" over "Resource": "*". Allowing users to have more privileges than needed to complete a task may violate the principle of least privilege and separation of duties.',
        level: NagMessageLevel.ERROR,
        rule: IAMPolicyNoStatementsWithAdminAccess,
        node: node
      })
      this.applyRule({
        ruleSuffixOverride: "EPS12",
        // eslint-disable-next-line max-len
        info: "The IAM policy grants full access, meaning the policy allows a principal to perform all actions on individual resources.",
        explanation:
        // eslint-disable-next-line max-len
        "Ensure IAM Actions are restricted to only those actions that are needed. Allowing users to have more privileges than needed to complete a task may violate the principle of least privilege and separation of duties.",
        level: NagMessageLevel.ERROR,
        rule: IAMPolicyNoStatementsWithFullAccess,
        node: node
      })
      this.applyRule({
        ruleSuffixOverride: "EPS13",
        // eslint-disable-next-line max-len
        info: "The S3 Bucket does not prohibit public read access through its Block Public Access configurations and bucket ACLs.",
        explanation:
        "The management of access should be consistent with the classification of the data.",
        level: NagMessageLevel.ERROR,
        rule: S3BucketPublicReadProhibited,
        node: node
      })
      this.applyRule({
        ruleSuffixOverride: "EPS14",
        // eslint-disable-next-line max-len
        info: "The S3 Bucket does not prohibit public write access through its Block Public Access configurations and bucket ACLs.",
        explanation:
        "The management of access should be consistent with the classification of the data.",
        level: NagMessageLevel.ERROR,
        rule: S3BucketPublicWriteProhibited,
        node: node
      })
      this.applyRule({
        ruleSuffixOverride: "EPS15",
        info: "The S3 Bucket is not encrypted with a KMS Key by default.",
        explanation:
        // eslint-disable-next-line max-len
        "Ensure that encryption is enabled for your Amazon Simple Storage Service (Amazon S3) buckets. Because sensitive data can exist at rest in an Amazon S3 bucket, enable encryption at rest to help protect that data.",
        level: NagMessageLevel.ERROR,
        rule: S3DefaultEncryptionKMS,
        node: node
      })
      this.applyRule({
        ruleSuffixOverride: "EPS16",
        info: "The secret is not encrypted with a KMS Customer managed key.",
        explanation:
        // eslint-disable-next-line max-len
        "To help protect data at rest, ensure encryption with AWS Key Management Service (AWS KMS) is enabled for AWS Secrets Manager secrets. Because sensitive data can exist at rest in Secrets Manager secrets, enable encryption at rest to help protect that data.",
        level: NagMessageLevel.ERROR,
        rule: SecretsManagerUsingKMSKey,
        node: node
      })
      this.applyRule({
        ruleSuffixOverride: "EPS17",
        info: "The SNS topic does not have KMS encryption enabled.",
        explanation:
        // eslint-disable-next-line max-len
        "Because sensitive data can exist at rest in published messages, enable encryption at rest to help protect that data.",
        level: NagMessageLevel.ERROR,
        rule: SNSEncryptedKMS,
        node: node
      })
      this.applyRule({
        ruleSuffixOverride: "EPS18",
        info: "The VPC's default security group allows inbound or outbound traffic.",
        explanation:
        // eslint-disable-next-line max-len
        "When creating a VPC through CloudFormation, the default security group will always be open. Therefore it is important to always close the default security group after stack creation whenever a VPC is created. Restricting all the traffic on the default security group helps in restricting remote access to your AWS resources.",
        level: NagMessageLevel.ERROR,
        rule: VPCDefaultSecurityGroupClosed,
        node: node
      })
      this.applyRule({
        ruleSuffixOverride: "EPS19",
        info: "The VPC does not have an associated Flow Log.",
        explanation:
        // eslint-disable-next-line max-len
        "The VPC flow logs provide detailed records for information about the IP traffic going to and from network interfaces in your Amazon Virtual Private Cloud (Amazon VPC). By default, the flow log record includes values for the different components of the IP flow, including the source, destination, and protocol.",
        level: NagMessageLevel.ERROR,
        rule: VPCFlowLogsEnabled,
        node: node
      })
    }
  }
}
