import {App, Stack} from "aws-cdk-lib"
import {Template, Match} from "aws-cdk-lib/assertions"
import {ManagedPolicy, PolicyStatement} from "aws-cdk-lib/aws-iam"
import {
  describe,
  test,
  beforeAll,
  expect
} from "vitest"

import {RestApiGateway} from "../../src/constructs/RestApiGateway.js"

describe("RestApiGateway without mTLS", () => {
  let stack: Stack
  let app: App
  let template: Template

  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "RestApiGatewayStack")

    const testPolicy = new ManagedPolicy(stack, "TestPolicy", {
      description: "test execution policy",
      statements: [
        new PolicyStatement({
          actions: ["lambda:InvokeFunction"],
          resources: ["*"]
        })
      ]
    })

    const apiGateway = new RestApiGateway(stack, "TestApiGateway", {
      stackName: "test-stack",
      logRetentionInDays: 30,
      mutualTlsTrustStoreKey: undefined,
      forwardCsocLogs: false,
      csocApiGatewayDestination: "",
      executionPolicies: [testPolicy]
    })

    // Add a dummy method to satisfy API Gateway validation
    apiGateway.api.root.addMethod("GET")

    template = Template.fromStack(stack)
  })

  test("creates CloudWatch log group with correct properties", () => {
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/apigateway/test-stack-apigw",
      KmsKeyId: {"Fn::ImportValue": "account-resources:CloudwatchLogsKmsKeyArn"},
      RetentionInDays: 30
    })
  })

  test("creates Splunk subscription filter", () => {
    template.hasResourceProperties("AWS::Logs::SubscriptionFilter", {
      FilterPattern: "",
      RoleArn: {"Fn::ImportValue": "lambda-resources:SplunkSubscriptionFilterRole"},
      DestinationArn: {"Fn::ImportValue": "lambda-resources:SplunkDeliveryStream"}
    })
  })

  test("does not create CSOC subscription filter", () => {
    const filters = template.findResources("AWS::Logs::SubscriptionFilter")
    const filterCount = Object.keys(filters).length
    expect(filterCount).toBe(1)
  })

  test("creates ACM certificate", () => {
    template.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: {
        "Fn::Join": ["", [
          "test-stack.",
          {"Fn::ImportValue": "eps-route53-resources:EPS-domain"}
        ]]
      },
      DomainValidationOptions: [{
        DomainName: {
          "Fn::Join": ["", [
            "test-stack.",
            {"Fn::ImportValue": "eps-route53-resources:EPS-domain"}
          ]]
        },
        HostedZoneId: {"Fn::ImportValue": "eps-route53-resources:EPS-ZoneID"}
      }],
      ValidationMethod: "DNS"
    })
  })

  test("creates REST API Gateway with correct configuration", () => {
    template.hasResourceProperties("AWS::ApiGateway::RestApi", {
      Name: "test-stack-apigw",
      EndpointConfiguration: {
        Types: ["REGIONAL"]
      },
      DisableExecuteApiEndpoint: false
    })
  })

  test("creates API Gateway domain name with TLS 1.2", () => {
    template.hasResourceProperties("AWS::ApiGateway::DomainName", {
      DomainName: {
        "Fn::Join": ["", [
          "test-stack.",
          {"Fn::ImportValue": "eps-route53-resources:EPS-domain"}
        ]]
      },
      EndpointConfiguration: {
        Types: ["REGIONAL"]
      },
      SecurityPolicy: "TLS_1_2"
    })
  })

  test("creates deployment with logging and metrics enabled", () => {
    template.hasResourceProperties("AWS::ApiGateway::Stage", {
      MethodSettings: [{
        LoggingLevel: "INFO",
        MetricsEnabled: true,
        DataTraceEnabled: false,
        HttpMethod: "*",
        ResourcePath: "/*"
      }],
      AccessLogSetting: Match.objectLike({
        Format: Match.stringLikeRegexp("requestId")
      })
    })
  })

  test("creates IAM role for API Gateway execution", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: [{
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: {
            Service: "apigateway.amazonaws.com"
          }
        }],
        Version: "2012-10-17"
      }
    })
  })

  test("creates Route53 A record", () => {
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Name: {
        "Fn::Join": ["", [
          "test-stack.",
          {"Fn::ImportValue": "eps-route53-resources:EPS-domain"},
          "."
        ]]
      },
      Type: "A"
    })
  })

  test("sets guard metadata on stage", () => {
    const stages = template.findResources("AWS::ApiGateway::Stage")
    const stageKeys = Object.keys(stages)
    expect(stageKeys.length).toBeGreaterThan(0)

    const stage = stages[stageKeys[0]]
    expect(stage.Metadata).toBeDefined()
    expect(stage.Metadata.guard).toBeDefined()
    expect(stage.Metadata.guard.SuppressedRules).toContain("API_GW_CACHE_ENABLED_AND_ENCRYPTED")
  })
})

describe("RestApiGateway with CSOC logs", () => {
  let stack: Stack
  let app: App
  let template: Template

  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "RestApiGatewayStack")

    const testPolicy = new ManagedPolicy(stack, "TestPolicy", {
      description: "test execution policy",
      statements: [
        new PolicyStatement({
          actions: ["lambda:InvokeFunction"],
          resources: ["*"]
        })
      ]
    })

    const apiGateway = new RestApiGateway(stack, "TestApiGateway", {
      stackName: "test-stack",
      logRetentionInDays: 30,
      mutualTlsTrustStoreKey: undefined,
      forwardCsocLogs: true,
      csocApiGatewayDestination: "arn:aws:logs:eu-west-2:123456789012:destination:csoc-destination",
      executionPolicies: [testPolicy]
    })

    // Add a dummy method to satisfy API Gateway validation
    apiGateway.api.root.addMethod("GET")

    template = Template.fromStack(stack)
  })

  test("creates both Splunk and CSOC subscription filters", () => {
    const filters = template.findResources("AWS::Logs::SubscriptionFilter")
    const filterCount = Object.keys(filters).length
    expect(filterCount).toBe(2)
  })

  test("creates CSOC subscription filter with correct destination", () => {
    template.hasResourceProperties("AWS::Logs::SubscriptionFilter", {
      FilterPattern: "",
      DestinationArn: "arn:aws:logs:eu-west-2:123456789012:destination:csoc-destination"
    })
  })
})

describe("RestApiGateway with mTLS", () => {
  let stack: Stack
  let app: App
  let template: Template

  beforeAll(() => {
    app = new App()
    stack = new Stack(app, "RestApiGatewayStack")

    const testPolicy = new ManagedPolicy(stack, "TestPolicy", {
      description: "test execution policy",
      statements: [
        new PolicyStatement({
          actions: ["lambda:InvokeFunction"],
          resources: ["*"]
        })
      ]
    })

    const apiGateway = new RestApiGateway(stack, "TestApiGateway", {
      stackName: "test-stack",
      logRetentionInDays: 30,
      mutualTlsTrustStoreKey: "truststore.pem",
      forwardCsocLogs: false,
      csocApiGatewayDestination: "",
      executionPolicies: [testPolicy]
    })

    // Add a dummy method to satisfy API Gateway validation
    apiGateway.api.root.addMethod("GET")

    template = Template.fromStack(stack)
  })

  test("creates trust store deployment log group", () => {
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/lambda/test-stack-truststore-deployment",
      KmsKeyId: {"Fn::ImportValue": "account-resources:CloudwatchLogsKmsKeyArn"},
      RetentionInDays: 30
    })
  })

  test("creates trust store deployment policy with S3 permissions", () => {
    interface PolicyResource {
      Properties?: {
        PolicyDocument?: {
          Statement?: Array<{Action?: Array<string>}>
        }
      }
    }
    interface Statement {
      Action?: Array<string>
    }

    const policies = template.findResources("AWS::IAM::ManagedPolicy")
    const trustStorePolicy = Object.values(policies).find((p: PolicyResource) =>
      p.Properties?.PolicyDocument?.Statement?.some((s: Statement) =>
        s.Action?.includes("s3:ListBucket")
      )
    ) as PolicyResource
    expect(trustStorePolicy).toBeDefined()
    const statements = trustStorePolicy.Properties?.PolicyDocument?.Statement ?? []
    expect(statements.some((s: Statement) => s.Action?.includes("s3:ListBucket"))).toBe(true)
    expect(statements.some((s: Statement) => s.Action?.includes("s3:GetObject"))).toBe(true)
    expect(statements.some((s: Statement) => s.Action?.includes("kms:Decrypt"))).toBe(true)
    expect(statements.some((s: Statement) => s.Action?.includes("logs:CreateLogStream"))).toBe(true)
  })

  test("creates trust store deployment role", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: {
              Service: "lambda.amazonaws.com"
            }
          })
        ]),
        Version: "2012-10-17"
      }
    })
  })

  test("creates bucket deployment custom resource", () => {
    const customResources = template.findResources("Custom::CDKBucketDeployment")
    expect(Object.keys(customResources).length).toBeGreaterThan(0)
  })

  test("disables execute-api endpoint when mTLS is enabled", () => {
    template.hasResourceProperties("AWS::ApiGateway::RestApi", {
      Name: "test-stack-apigw",
      DisableExecuteApiEndpoint: true
    })
  })

  test("configures mTLS on domain name", () => {
    interface DomainNameResource {
      Properties: {
        MutualTlsAuthentication: {
          TruststoreUri: unknown
        }
      }
    }

    const domainNames = template.findResources("AWS::ApiGateway::DomainName")
    const domainName = Object.values(domainNames)[0] as DomainNameResource
    expect(domainName.Properties.MutualTlsAuthentication).toBeDefined()
    expect(domainName.Properties.MutualTlsAuthentication.TruststoreUri).toBeDefined()
  })
})
