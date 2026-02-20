# Electronic Prescription Service CDK Utils

![Build](https://github.com/NHSDigital/eps-cdk-utils/workflows/release/badge.svg?branch=main)

This repository contains a docker image used to deploy CDK to our environments and a CDK constructs library for common EPS project patterns, plus shared deployment utilities.

- `docker/` Contains Dockerfile used to build image used fo for CDK deployments
- `packages/cdkConstructs/` Contains common CDK constructs and CDK helpers used in EPS projects
- `packages/deploymentUtils/` Contains shared code for standardising OpenAPI specifications and performing Proxygen-based deployments
- `scripts/` Utilities helpful to developers of this specification
- `.github/` Contains GitHub workflows that are used for building and deploying from pull requests and releases

## Releases
A release of this code happens automatically every Wednesday, but can also be triggered manually by running the release workflow.   
The release workflow does the following
 - creates a new tagged version
 - creates a new version of the cdk construct library and publishes it to github
 - pushes the cdk-utils docker image to dev and all other environments (subject to manual release approval in github actions)

## CDK Constructs (`packages/cdkConstructs`)

This contains common CDK constructs and helpers used in EPS projects.

Available constructs and helpers include:

- `TypescriptLambdaFunction` – A reusable construct for TypeScript Lambda functions
- `createApp` – Helper for creating a CDK `App` pre-configured with standard EPS tags and stack props
- `deleteUnusedStacks` – Helper functions for cleaning up superseded or PR-based CloudFormation stacks and their Route 53 records

### CDK app bootstrap (`createApp`)

The helper in [packages/cdkConstructs/src/apps/createApp.ts](packages/cdkConstructs/src/apps/createApp.ts) creates a CDK `App` and applies the standard NHS EPS tagging and configuration.

Usage example:

```ts
import {createApp} from "@NHSDigital/eps-cdk-constructs"

const {app, props} = createApp({
	productName: "Electronic Prescription Service",
	appName: "eps-api",
	repoName: "eps-cdk-utils",
	driftDetectionGroup: "eps-api"
})

// Use `app` and `props` when defining stacks
```

`createApp` reads deployment metadata from environment variables such as `versionNumber`, `commitId`, `environment` and `isPullRequest`, and exposes them via the returned `props` for use when defining stacks.

### Stack cleanup helpers (`deleteUnusedStacks`)

The helpers in [packages/cdkConstructs/src/stacks/deleteUnusedStacks.ts](packages/cdkConstructs/src/stacks/deleteUnusedStacks.ts) are used to clean up old CloudFormation stacks and their DNS records:

- `deleteUnusedMainStacks(baseStackName, getActiveVersions, hostedZoneName?)` – deletes superseded main and sandbox stacks once the active version has been deployed for at least 24 hours, and removes matching CNAME records from Route 53.
- `deleteUnusedPrStacks(baseStackName, repoName, hostedZoneName?)` – deletes stacks created for pull requests whose GitHub PRs have been closed, and cleans up their CNAME records.

These functions are designed to be invoked from scheduled jobs (for example, a nightly cleanup workflow) after deployment. They rely on:

- APIM status endpoints to determine the active API versions (via `getActiveApiVersions`).
- GitHub’s API to determine whether PRs are closed.
- Route 53 APIs to enumerate and delete CNAME records associated with the stacks.

Refer to [packages/cdkConstructs/tests/stacks/deleteUnusedStacks.test.ts](packages/cdkConstructs/tests/stacks/deleteUnusedStacks.test.ts) for example scenarios.

## Deployment utilities (`packages/deploymentUtils`)

The [packages/deploymentUtils](packages/deploymentUtils) package contains utilities for working with OpenAPI specifications and Proxygen-based API deployments.

It exposes the following main entry points via [packages/deploymentUtils/src/index.ts](packages/deploymentUtils/src/index.ts):

- `deployApi` – Normalises an OpenAPI specification and deploys it via Proxygen Lambda functions, optionally performing blue/green deployments and publishing documentation to the appropriate catalogue.
- `writeSchemas` – Writes JSON Schemas to disk, collapsing `examples` arrays into a single `example` value to be compatible with OAS.
- `deleteProxygenDeployments` – Removes Proxygen PTL instances that correspond to closed GitHub pull requests for a given API.
- Config helpers from `config/index` – used to resolve configuration and CloudFormation export values.
- `checkDestructiveChangeSet` – Describes a CloudFormation change set, filters out replacements and removals (optionally applying time-bound waivers) and throws if anything destructive remains.

`checkDestructiveChangeSet(changeSetName, stackName, region, allowedChanges?)` is useful in CI pipelines for blocking deployments that would recreate or delete infrastructure. The optional `allowedChanges` array lets you provide short-lived waivers, for example:

```ts
import {checkDestructiveChangeSet} from "@nhsdigital/eps-deployment-utils"

await checkDestructiveChangeSet(
	process.env.CDK_CHANGE_SET_NAME,
	process.env.STACK_NAME,
	process.env.AWS_REGION,
	[
		{
			LogicalResourceId: "MyAlarm",
			PhysicalResourceId: "monitoring-alarm",
			ResourceType: "AWS::CloudWatch::Alarm",
			StackName: "monitoring",
			ExpiryDate: "2026-03-01T00:00:00Z",
			AllowedReason: "Pending rename rollout"
		}
	]
)
```

Each waiver is effective only when the stack name, logical ID, physical ID, and resource type all match and the waiver’s `ExpiryDate` is later than the change set’s `CreationTime`. When no destructive changes remain, the helper logs a confirmation message; otherwise it prints the problematic resources and throws.

Typical usage pattern (pseudo-code):

```ts
import {deployApi} from "@NHSDigital/eps-deployment-utils"

await deployApi({
	spec,
	apiName: "eps-api",
	version: "v1.2.3",
	apigeeEnvironment: "int",
	isPullRequest: false,
	awsEnvironment: "dev",
	stackName: "eps-api-v1-2-3",
	mtlsSecretName: "eps-api-mtls",
	clientCertExportName: "ClientCertArn",
	clientPrivateKeyExportName: "ClientPrivateKeyArn",
	proxygenPrivateKeyExportName: "ProxygenPrivateKeyArn",
	proxygenKid: "kid-123",
	hiddenPaths: ["/internal-only"]
},
true,   // blueGreen
false   // dryRun
)
```

See the source files under [packages/deploymentUtils/src/specifications](packages/deploymentUtils/src/specifications) and their tests in [packages/deploymentUtils/tests](packages/deploymentUtils/tests) for fuller examples and expected behaviours.

## Contributing

Contributions to this project are welcome from anyone, providing that they
conform to the [guidelines for contribution](./CONTRIBUTING.md) and the [community code of conduct](./CODE_OF_CONDUCT.md).

### Licensing

This code is dual licensed under the MIT license and the OGL (Open Government
License). Any new work added to this repository must conform to the conditions of
these licenses. In particular this means that this project may not depend on
GPL-licensed or AGPL-licensed libraries, as these would violate the terms of those
libraries' licenses.   

These files derive from https://github.com/cdklabs/cdk-nag and remain under Apache 2.0 licence
`packages/cdkConstructs/src/nag/rules/APIGWStructuredLogging.ts` 
`packages/cdkConstructs/tests/nag/ApiGWStructuredLogging.test.ts`   

The contents of this repository are protected by Crown Copyright (C).

## Development

It is recommended that you use Visual Studio Code and a devcontainer as this
will install all necessary components and correct versions of tools and languages.
See [https://code.visualstudio.com/docs/devcontainers/containers](https://code.visualstudio.com/docs/devcontainers/containers) for details on how to set this up on your host machine.

All commits must be made using [signed commits](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits).


### Testing changes to construct or deploymentUtils libraries
To test changes to the construct library or the deploymentUtils package, you need to package the relevant library and install it into the project you want to test it in.

Either 
 - run `make package` from this project and copy the generated `.tgz` file(s) from the lib folder to the project you want to test in
 - create a pull request and from the pull request workflow run, download the generated `.tgz` artifact(s) (for example `nhsdigital-eps-cdk-constructs-1.0.0.tgz` and/or `nhsdigital-eps-deployment-utils-1.0.0.tgz`) to the project you want to test in

In the project you want to test in, run the following as appropriate:

```bash
# Install the CDK constructs library
npm install --save nhsdigital-eps-cdk-constructs-1.0.0.tgz --workspace packages/cdk/

# Install the deploymentUtils library
npm install --save nhsdigital-eps-deployment-utils-1.0.0.tgz --workspace packages/specifications/
```

You will then be able to use them - for example:

```typescript
import {TypescriptLambdaFunction} from "@NHSDigital/eps-cdk-constructs"
```

or

```typescript
import {deployApi} from "@nhsdigital/eps-deployment-utils"
```

### Make Commands

There are `make` commands that are run as part of the CI pipeline and help alias some
functionality during development.

#### Install targets

- `install-node` Installs node dependencies
- `install-python` Installs python dependencies
- `install-hooks` Installs git pre commit hooks
- `install` Runs all install targets

#### Linting and testing

- `lint` Runs lint for all code
- `test` Runs unit tests for all code

#### Compiling

- `compile` Compiles all code
- `package` Creates distributable tarball of CDK constructs

#### Check licenses

- `check-licenses` Checks licenses for all packages used

#### Clean targets

- `clean` Clears up any files that have been generated by building or testing locally
- `deep-clean` Runs clean target and also removes any node_modules and python libraries installed locally
