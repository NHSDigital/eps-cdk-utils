import {RemovalPolicy} from "aws-cdk-lib"
import {
  CfnStage,
  EndpointType,
  LogGroupLogDestination,
  MethodLoggingLevel,
  MTLSConfig,
  RestApi,
  SecurityPolicy
} from "aws-cdk-lib/aws-apigateway"
import {
  IManagedPolicy,
  IRole,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal
} from "aws-cdk-lib/aws-iam"
import {Stream} from "aws-cdk-lib/aws-kinesis"
import {Key} from "aws-cdk-lib/aws-kms"
import {CfnSubscriptionFilter, LogGroup} from "aws-cdk-lib/aws-logs"
import {Construct} from "constructs"
import {accessLogFormat} from "./RestApiGateway/accessLogFormat.js"
import {Certificate, CertificateValidation} from "aws-cdk-lib/aws-certificatemanager"
import {Bucket} from "aws-cdk-lib/aws-s3"
import {BucketDeployment, Source} from "aws-cdk-lib/aws-s3-deployment"
import {
  ARecord,
  AaaaRecord,
  HostedZone,
  IHostedZone,
  RecordTarget
} from "aws-cdk-lib/aws-route53"
import {ApiGateway as ApiGatewayTarget} from "aws-cdk-lib/aws-route53-targets"
import {NagSuppressions} from "cdk-nag"
import {ACCOUNT_RESOURCES, LAMBDA_RESOURCES} from "../constants"
import {addSuppressions} from "../utils/helpers"

/** Configuration for creating a REST API with optional mTLS and log forwarding integrations. */
export interface RestApiGatewayProps {
  /** Stack name, used as prefix for resource naming and DNS records. */
  readonly stackName: string
  /** Stack UUID, used as a unique identifier for the stack. Optional */
  readonly stackUUID?: string
  /** Shared retention period for API and deployment-related log groups. */
  readonly logRetentionInDays: number
  /** Truststore object key to enable mTLS; leave undefined to disable mTLS or when enableServiceDomain is false. */
  readonly mutualTlsTrustStoreKey: string | undefined
  /** Enables creation of a second subscription filter to forward logs to CSOC. */
  readonly forwardCsocLogs: boolean
  /** Destination ARN used by the optional CSOC subscription filter. */
  readonly csocApiGatewayDestination: string
  /** Managed policies attached to the API Gateway execution role. */
  readonly executionPolicies: Array<IManagedPolicy>
  /**
   * When true (default), creates the custom service domain, ACM certificate, and Route53 records.
   */
  readonly enableServiceDomain?: boolean
}

const getTrustStoreKeyPrefix = (stackName: string, stackUUID?: string) => {
  if (stackUUID) {
    return `cpt-api/${stackName}-${stackUUID}-truststore`
  } else {
    return `cpt-api/${stackName}-truststore`
  }
}

/** Creates a regional REST API with standard logging, DNS, and optional mTLS/CSOC integration. */
export class RestApiGateway extends Construct {
  /** Created API Gateway instance. */
  public readonly api: RestApi

  /** IAM role assumed by API Gateway integrations. */
  public readonly role: IRole

  /**
   * Builds API Gateway infrastructure and validates CSOC forwarding configuration.
   * @example
   * ```ts
   * const api = new RestApiGateway(this, "MyApi", {
   *   stackName: "my-service",
   *   logRetentionInDays: 30,
   *   mutualTlsTrustStoreKey: "truststore.pem",
   *   forwardCsocLogs: true,
   *   csocApiGatewayDestination: "arn:aws:logs:eu-west-2:123456789012:destination:csoc",
   *   executionPolicies: [myLambdaInvokePolicy],
   *   enableServiceDomain: true
   * })
   * api.api.root.addResource("patients")
   * ```
   */
  public constructor(scope: Construct, id: string, props: RestApiGatewayProps) {
    super(scope, id)

    const enableServiceDomain = (props.enableServiceDomain ?? true)

    if (props.forwardCsocLogs && props.csocApiGatewayDestination === "") {
      throw new Error("csocApiGatewayDestination must be provided when forwardCsocLogs is true")
    }

    if (!enableServiceDomain && props.mutualTlsTrustStoreKey) {
      throw new Error("mutualTlsTrustStoreKey should not be provided when enableServiceDomain is false")
    }

    // Imports
    const cloudWatchLogsKmsKey = Key.fromKeyArn(
      this, "cloudWatchLogsKmsKey", ACCOUNT_RESOURCES.CloudwatchLogsKmsKeyArn)

    const splunkDeliveryStream = Stream.fromStreamArn(
      this, "SplunkDeliveryStream", LAMBDA_RESOURCES.SplunkDeliveryStream)

    const splunkSubscriptionFilterRole = Role.fromRoleArn(
      this, "splunkSubscriptionFilterRole", LAMBDA_RESOURCES.SplunkSubscriptionFilterRole)

    const trustStoreBucket = Bucket.fromBucketArn(
      this, "TrustStoreBucket", ACCOUNT_RESOURCES.TrustStoreBucket)

    const trustStoreDeploymentBucket = Bucket.fromBucketArn(
      this, "TrustStoreDeploymentBucket", ACCOUNT_RESOURCES.TrustStoreDeploymentBucket)

    const trustStoreBucketKmsKey = Key.fromKeyArn(
      this, "TrustStoreBucketKmsKey", ACCOUNT_RESOURCES.TrustStoreBucketKMSKey)

    let hostedZone: IHostedZone | undefined
    let serviceDomainName: string | undefined

    if (enableServiceDomain) {
      const epsDomainName: string = ACCOUNT_RESOURCES.EpsDomainName
      hostedZone = HostedZone.fromHostedZoneAttributes(this, "HostedZone", {
        hostedZoneId: ACCOUNT_RESOURCES.EpsZoneId,
        zoneName: epsDomainName
      })
      serviceDomainName = `${props.stackName}.${epsDomainName}`
    }

    // Resources
    const logGroup = new LogGroup(this, "ApiGatewayAccessLogGroup", {
      encryptionKey: cloudWatchLogsKmsKey,
      logGroupName: `/aws/apigateway/${props.stackName}-apigw`,
      retention: props.logRetentionInDays,
      removalPolicy: RemovalPolicy.DESTROY
    })

    new CfnSubscriptionFilter(this, "ApiGatewayAccessLogsSplunkSubscriptionFilter", {
      destinationArn: splunkDeliveryStream.streamArn,
      filterPattern: "",
      logGroupName: logGroup.logGroupName,
      roleArn: splunkSubscriptionFilterRole.roleArn
    })

    if (props.forwardCsocLogs) {
      new CfnSubscriptionFilter(this, "ApiGatewayAccessLogsCSOCSubscriptionFilter", {
        destinationArn: props.csocApiGatewayDestination,
        filterPattern: "",
        logGroupName: logGroup.logGroupName,
        roleArn: splunkSubscriptionFilterRole.roleArn
      })
    }

    const certificate = enableServiceDomain && hostedZone && serviceDomainName
      ? new Certificate(this, "Certificate", {
        domainName: serviceDomainName,
        validation: CertificateValidation.fromDns(hostedZone)
      })
      : undefined

    let mtlsConfig: MTLSConfig | undefined

    if (enableServiceDomain && props.mutualTlsTrustStoreKey) {
      const trustStoreKeyPrefix = getTrustStoreKeyPrefix(props.stackName, props.stackUUID)
      const logGroup = new LogGroup(this, "LambdaLogGroup", {
        encryptionKey: cloudWatchLogsKmsKey,
        logGroupName: `/aws/lambda/${props.stackName}-truststore-deployment`,
        retention: props.logRetentionInDays,
        removalPolicy: RemovalPolicy.DESTROY
      })
      const trustStoreDeploymentPolicy = new ManagedPolicy(this, "TrustStoreDeploymentPolicy", {
        statements: [
          new PolicyStatement({
            actions: [
              "s3:ListBucket"
            ],
            resources: [
              trustStoreBucket.bucketArn,
              trustStoreDeploymentBucket.bucketArn
            ]
          }),
          new PolicyStatement({
            actions: [
              "s3:GetObject"
            ],
            resources: [trustStoreBucket.arnForObjects(props.mutualTlsTrustStoreKey)]
          }),
          new PolicyStatement({
            actions: [
              "s3:DeleteObject",
              "s3:PutObject"
            ],
            resources: [
              trustStoreDeploymentBucket.arnForObjects(trustStoreKeyPrefix + "/" + props.mutualTlsTrustStoreKey)
            ]
          }),
          new PolicyStatement({
            actions: [
              "kms:Decrypt",
              "kms:Encrypt",
              "kms:GenerateDataKey"
            ],
            resources: [trustStoreBucketKmsKey.keyArn]
          }),
          new PolicyStatement({
            actions: [
              "logs:CreateLogStream",
              "logs:PutLogEvents"
            ],
            resources: [
              logGroup.logGroupArn,
              `${logGroup.logGroupArn}:log-stream:*`
            ]
          })
        ]
      })
      NagSuppressions.addResourceSuppressions(trustStoreDeploymentPolicy, [
        {
          id: "AwsSolutions-IAM5",
          // eslint-disable-next-line max-len
          reason: "Suppress error for not having wildcards in permissions. This is a fine as we need to have permissions on all log streams under path"
        }
      ])
      const trustStoreDeploymentRole = new Role(this, "TrustStoreDeploymentRole", {
        assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
        managedPolicies: [trustStoreDeploymentPolicy]
      }).withoutPolicyUpdates()
      const deployment = new BucketDeployment(this, "TrustStoreDeployment", {
        sources: [Source.bucket(trustStoreBucket, props.mutualTlsTrustStoreKey)],
        destinationBucket: trustStoreDeploymentBucket,
        destinationKeyPrefix: trustStoreKeyPrefix,
        extract: false,
        retainOnDelete: false,
        role: trustStoreDeploymentRole,
        logGroup: logGroup
      })
      mtlsConfig = {
        bucket: deployment.deployedBucket,
        key: trustStoreKeyPrefix + "/" + props.mutualTlsTrustStoreKey
      }
    }

    const apiGateway = new RestApi(this, "ApiGateway", {
      restApiName: `${props.stackName}-apigw`,
      ...(enableServiceDomain
        ? {
          domainName: {
            domainName: serviceDomainName!,
            certificate: certificate!,
            securityPolicy: SecurityPolicy.TLS_1_2,
            endpointType: EndpointType.REGIONAL,
            mtls: mtlsConfig
          }
        } : {}),
      disableExecuteApiEndpoint: mtlsConfig ? true : false, // NOSONAR
      endpointConfiguration: {
        types: [EndpointType.REGIONAL]
      },
      deploy: true,
      deployOptions: {
        accessLogDestination: new LogGroupLogDestination(logGroup),
        accessLogFormat: accessLogFormat(),
        loggingLevel: MethodLoggingLevel.INFO,
        metricsEnabled: true
      }
    })

    const role = new Role(this, "ApiGatewayRole", {
      assumedBy: new ServicePrincipal("apigateway.amazonaws.com"),
      managedPolicies: props.executionPolicies
    }).withoutPolicyUpdates()

    if (enableServiceDomain && hostedZone) {
      new ARecord(this, "ARecord", {
        recordName: props.stackName,
        target: RecordTarget.fromAlias(new ApiGatewayTarget(apiGateway)),
        zone: hostedZone
      })

      new AaaaRecord(this, "AaaaRecord", {
        recordName: props.stackName,
        target: RecordTarget.fromAlias(new ApiGatewayTarget(apiGateway)),
        zone: hostedZone
      })
    }

    const cfnStage = apiGateway.deploymentStage.node.defaultChild as CfnStage
    addSuppressions([cfnStage], ["API_GW_CACHE_ENABLED_AND_ENCRYPTED"])

    // Outputs
    this.api = apiGateway
    this.role = role
  }
}
