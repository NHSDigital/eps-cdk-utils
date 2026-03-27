import {Pass} from "aws-cdk-lib/aws-stepfunctions"
import {Construct} from "constructs"

const errorOperationOutcome = `{% $string(
  {
    "ResourceType": "OperationOutcome",
    "meta": {
      "lastUpdated": $now()
    },
    "issue": [
      {
        "code": "exception",
        "severity": "fatal",
        "diagnostics": "Unknown Error.",
        "details": {
          "coding": [
            {
              "system": "https://fhir.nhs.uk/CodeSystem/http-error-codes",
              "code": "SERVER_ERROR",
              "display": "500: The Server has encountered an error processing the request."
            }
          ]
        }
      }
    ]
  }
) %}`

/** Produces a fixed 500 FHIR OperationOutcome payload for unhandled workflow failures. */
export class CatchAllErrorPass extends Construct {
  /** Pass state returned by this construct for chaining in state machine definitions. */
  public readonly state: Pass

  /**
   * Creates a terminal-style error response payload without exposing internal exception detail.
   * @example
   * ```ts
   * const catchAll = new CatchAllErrorPass(this, 'CatchAllError')
   * definition.addCatch(catchAll.state)
   * ```
   */
  public constructor(scope: Construct, id: string) {
    super(scope, id)

    const state = new Pass(this, "Catch All Error", {
      outputs: {
        Payload: {
          statusCode: 500,
          headers: {
            "Content-Type": "application/fhir+json",
            "Cache-Control": "no-cache"
          },
          body: errorOperationOutcome
        }
      }
    })

    this.state = state
  }
}
