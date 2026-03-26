import {IResource, PassthroughBehavior, StepFunctionsIntegration} from "aws-cdk-lib/aws-apigateway"
import {IRole} from "aws-cdk-lib/aws-iam"
import {HttpMethod} from "aws-cdk-lib/aws-lambda"
import {Construct} from "constructs"
import {stateMachineRequestTemplate} from "./templates/stateMachineRequest.js"
import {stateMachine200ResponseTemplate, stateMachineErrorResponseTemplate} from "./templates/stateMachineResponses.js"
import {ExpressStateMachine} from "../StateMachine.js"

export interface StateMachineEndpointProps {
  /** Parent API resource under which the state machine endpoint is added. */
  parentResource: IResource
  /** Path segment used to create the child API resource. */
  readonly resourceName: string
  /** HTTP verb bound to the Step Functions integration. */
  readonly method: HttpMethod
  /** Invocation role used by API Gateway when starting workflow executions. */
  restApiGatewayRole: IRole
  /** State machine wrapper construct providing the target workflow ARN and integration target. */
  stateMachine: ExpressStateMachine
}

/** Adds an API Gateway resource/method that starts an Express Step Functions execution. */
export class StateMachineEndpoint extends Construct {
  resource: IResource

  /** Wires request and response mapping templates for JSON and FHIR payload flows. */
  public constructor(scope: Construct, id: string, props: StateMachineEndpointProps) {
    super(scope, id)

    const requestTemplate = stateMachineRequestTemplate(props.stateMachine.stateMachine.stateMachineArn)

    const resource = props.parentResource.addResource(props.resourceName)
    resource.addMethod(props.method, StepFunctionsIntegration.startExecution(props.stateMachine.stateMachine, {
      credentialsRole: props.restApiGatewayRole,
      passthroughBehavior: PassthroughBehavior.WHEN_NO_MATCH,
      requestTemplates: {
        "application/json": requestTemplate,
        "application/fhir+json": requestTemplate
      },
      integrationResponses: [
        {
          statusCode: "200",
          responseTemplates: {
            "application/json": stateMachine200ResponseTemplate
          }
        },
        {
          statusCode: "400",
          selectionPattern: String.raw`^4\d{2}.*`,
          responseTemplates: {
            "application/json": stateMachineErrorResponseTemplate("400")
          }
        },
        {
          statusCode: "500",
          selectionPattern: String.raw`^5\d{2}.*`,
          responseTemplates: {
            "application/json": stateMachineErrorResponseTemplate("500")
          }
        }
      ]
    }), {
      methodResponses: []
    })

    this.resource = resource
  }
}
