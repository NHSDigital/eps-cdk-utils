import {IResource, LambdaIntegration} from "aws-cdk-lib/aws-apigateway"
import {IRole} from "aws-cdk-lib/aws-iam"
import {HttpMethod, IFunction} from "aws-cdk-lib/aws-lambda"
import {Construct} from "constructs"

/** Lambda container shape consumed by endpoint integration wiring. */
export interface LambdaFunctionHolder {
  /** Lambda invoked by this API resource method. */
  readonly function: IFunction
}

/** Parameters used to create an API resource and attach a Lambda integration. */
export interface LambdaEndpointProps {
  /** Parent API resource under which this endpoint path is created. */
  parentResource: IResource
  /** Path segment added beneath the parent resource. */
  readonly resourceName: string
  /** HTTP method exposed on the created API resource. */
  readonly method: HttpMethod
  /** Role assumed by API Gateway when invoking the integration Lambda. */
  restApiGatewayRole: IRole
  /** Lambda reference used by the generated integration. */
  lambdaFunction: LambdaFunctionHolder
}

/** Adds a child API resource and wires it to a Lambda integration with explicit credentials. */
export class LambdaEndpoint extends Construct {
  /** API resource created by this construct. */
  resource: IResource

  /**
   * Creates the resource/method pair and stores the resulting API resource handle.
   */
  public constructor(scope: Construct, id: string, props: LambdaEndpointProps) {
    super(scope, id)

    const resource = props.parentResource.addResource(props.resourceName)
    resource.addMethod(props.method, new LambdaIntegration(props.lambdaFunction.function, {
      credentialsRole: props.restApiGatewayRole
    }))

    this.resource = resource
  }
}
