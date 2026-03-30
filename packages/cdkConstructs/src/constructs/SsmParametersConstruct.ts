import {Effect, ManagedPolicy, PolicyStatement} from "aws-cdk-lib/aws-iam"
import {StringParameter} from "aws-cdk-lib/aws-ssm"
import {Construct} from "constructs"

/**
 * Definition for a single SSM String parameter and its output export metadata.
 *
 * @property id Unique identifier used for construct and output logical IDs.
 * @property nameSuffix Suffix appended to stackName to create the parameter name.
 * The final SSM parameter name is `${stackName}-${nameSuffix}`.
 * @property description Description stored with the SSM parameter.
 * @property value Value stored in the SSM parameter.
 * @property outputExportSuffix Optional export suffix for the output containing
 * the parameter name. Defaults to `nameSuffix`.
 * @property outputDescription Optional output description. Defaults to
 * `description`.
 */
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
   * @default nameSuffix value
   */
  readonly outputExportSuffix?: string
  /**
   * Optional output description.
   * @default description value
   */
  readonly outputDescription?: string
}

/**
 * Properties used to configure {@link SsmParametersConstruct}.
 *
 * @property namePrefix Prefix used in SSM parameter names and CloudFormation
 * export names.
 * @property parameters List of SSM parameters to create.
 * @property readPolicyDescription Description for the managed policy that grants
 * read access. Defaults to "Allows reading SSM parameters".
 * @property readPolicyOutputDescription Description for the output exporting the
 * managed policy ARN. Defaults to "Access to the parameters used by the integration".
 * @property readPolicyExportSuffix Export suffix for the output exporting the
 * managed policy ARN.
 */
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
   */
  readonly readPolicyExportSuffix: string
}

/**
 * Creates a bundle of SSM String parameters, a managed policy to read them,
 * and CloudFormation outputs to export parameter names and policy ARN.
 */
export class SsmParametersConstruct extends Construct {
  public readonly parameters: Record<string, StringParameter>
  public readonly readParametersPolicy: ManagedPolicy

  /**
   * Creates SSM String parameters, a managed read policy, and CloudFormation outputs.
   *
   * @param scope CDK construct scope.
   * @param id Unique construct identifier.
   * @param props Configuration for parameter names, values, and exported outputs.
   * @throws {Error} Throws when no parameter definitions are provided.
   * @throws {Error} Throws when duplicate parameter IDs or parameter names are detected.
   */
  public constructor(scope: Construct, id: string, props: SsmParametersConstructProps) {
    super(scope, id)

    const {
      namePrefix,
      parameters,
      readPolicyDescription = "Allows reading SSM parameters"
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

      const parameterName = `${namePrefix}-${parameter.nameSuffix}`
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

    this.parameters = createdParameters
    this.readParametersPolicy = readParametersPolicy
  }
}
