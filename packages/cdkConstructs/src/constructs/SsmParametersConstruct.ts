import {CfnOutput} from "aws-cdk-lib"
import {Effect, ManagedPolicy, PolicyStatement} from "aws-cdk-lib/aws-iam"
import {StringParameter} from "aws-cdk-lib/aws-ssm"
import {Construct} from "constructs"

export interface SsmParameterDefinition {
  /**
   * Unique identifier used for construct and output logical IDs.
   */
  readonly id: string
  /**
   * Suffix appended to stackName to create the parameter name.
   * The final SSM parameter name is `${stackName}-${nameSuffix}`.
   */
  readonly nameSuffix: string
  /**
   * Description stored with the SSM parameter.
   */
  readonly description: string
  /**
   * Value stored in the SSM parameter.
   */
  readonly value: string
  /**
   * Optional export suffix for the output containing the parameter name.
   * Defaults to `nameSuffix`.
   */
  readonly outputExportSuffix?: string
  /**
   * Optional output description.
   * Defaults to `description`.
   */
  readonly outputDescription?: string
}

export interface SsmParametersConstructProps {
  /**
   * Prefix used in SSM parameter names and CloudFormation export names.
   */
  readonly namePrefix: string
  /**
   * List of SSM parameters to create.
   */
  readonly parameters: Array<SsmParameterDefinition>
  /**
   * Description for the managed policy that grants read access.
   * @default "Allows reading SSM parameters"
   */
  readonly readPolicyDescription?: string
  /**
   * Description for the output exporting the managed policy ARN.
   * @default "Access to the parameters used by the integration"
   */
  readonly readPolicyOutputDescription?: string
  /**
   * Export suffix for the output exporting the managed policy ARN.
   * @default "GetParametersPolicy"
   */
  readonly readPolicyExportSuffix?: string
}

/**
 * Creates a bundle of SSM String parameters, a managed policy to read them,
 * and CloudFormation outputs to export parameter names and policy ARN.
 */
export class SsmParametersConstruct extends Construct {
  public readonly parameters: Record<string, StringParameter>
  public readonly readParametersPolicy: ManagedPolicy

  public constructor(scope: Construct, id: string, props: SsmParametersConstructProps) {
    super(scope, id)

    const {
      namePrefix: stackName,
      parameters,
      readPolicyDescription = "Allows reading SSM parameters",
      readPolicyOutputDescription = "Access to the parameters used by the integration",
      readPolicyExportSuffix = "GetParametersPolicy"
    } = props

    if (parameters.length === 0) {
      throw new Error("SsmParametersConstruct requires at least one parameter definition")
    }

    const createdParameters: Record<string, StringParameter> = {}

    const seenIds = new Set<string>()
    const seenNames = new Set<string>()

    for (const parameter of parameters) {
      const parameterId = `${parameter.id}Parameter`
      if (seenIds.has(parameterId)) {
        throw new Error(`Duplicate parameter id detected: ${parameter.id}.`)
      }
      seenIds.add(parameterId)

      const parameterName = `${stackName}-${parameter.nameSuffix}`
      if (seenNames.has(parameterName)) {
        throw new Error(`Duplicate parameter name detected: ${parameterName}.`)
      }
      seenNames.add(parameterName)

      const ssmParameter = new StringParameter(this, parameterId, {
        parameterName,
        description: parameter.description,
        stringValue: parameter.value
      })

      createdParameters[parameter.id] = ssmParameter

      new CfnOutput(this, `${parameter.id}ParameterNameOutput`, {
        description: parameter.outputDescription ?? parameter.description,
        value: ssmParameter.parameterName,
        exportName: `${stackName}-${parameter.outputExportSuffix ?? parameter.nameSuffix}`
      })
    }

    const readParametersPolicy = new ManagedPolicy(this, "GetParametersPolicy", {
      description: readPolicyDescription,
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["ssm:GetParameter", "ssm:GetParameters"],
          resources: Object.values(createdParameters).map((parameter) => parameter.parameterArn)
        })
      ]
    })

    new CfnOutput(this, "ReadParametersPolicyOutput", {
      description: readPolicyOutputDescription,
      value: readParametersPolicy.managedPolicyArn,
      exportName: `${stackName}-${readPolicyExportSuffix}`
    })

    this.parameters = createdParameters
    this.readParametersPolicy = readParametersPolicy
  }
}
