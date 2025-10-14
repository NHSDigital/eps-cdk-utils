# eps-cdk-utils

This contains a docker image used to deploy cdk to our environments and a cdk-constructs library

# cdk-constructs

This contains common cdk constructs used in eps projects

Available constructs are

- TypescriptLambdaFunction

# development

If you want to test a new construct, add it to packages/cdkConstructs
Run the following to produce a distributable tarball
```
make package
```
This will produce a tarball file in lib folder

Copy this to the project you want to use it in and use the following to install it

```
npm install --save NHSDigital-eps-cdk-constructs-1.0.0.tgz --workspace packages/cdk/ 
```

You will then be able to use it - eg
```
import {TypescriptLambdaFunction} from "@NHSDigital/eps-cdk-constructs"
```
