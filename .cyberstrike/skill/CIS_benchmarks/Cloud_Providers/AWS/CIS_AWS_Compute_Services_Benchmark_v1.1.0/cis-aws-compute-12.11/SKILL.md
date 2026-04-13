---
name: cis-aws-compute-12.11
description: "Ensure that the runtime environment versions used for your Lambda functions do not have end of support dates"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lambda, serverless, runtime, eol, patching, deprecation]
cis_id: "12.11"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-12.8, cis-aws-compute-12.12]
prerequisites: []
severity_boost: {}
---

# Ensure that the runtime environment versions used for your Lambda functions do not have end of support dates

## Description

Always using a recent version of the execution environment configured for your Amazon Lambda functions adheres to best practices for the newest software features, the latest security patches and bug fixes, and performance and reliability.

## Rationale

When you execute your Lambda functions using recent versions of the implemented runtime environment, you should benefit from new features and enhancements, better security, along with performance and reliability.

## Impact

Upgrading runtime versions may introduce breaking changes. Functions should be thoroughly tested with the new runtime before deployment.

## Audit Procedure

### Using AWS Console

1. Login to the AWS Console using https://console.aws.amazon.com/lambda/.
2. In the left column, under `AWS Lambda`, click `Functions`.
3. Under `Function name` click on the name of the function that you want to review
4. Click Code tab
5. In the Runtime settings section, check the Runtime attribute value to determine the runtime version.
6. Compare the function runtime with the updated list of Amazon Lambda runtimes. Link is in the resource section.
7. If the version you are using is not the latest or is on the EOL list, the selected Amazon Lambda function is using an old and deprecated runtime environment.
8. Refer to the remediation below.
9. Repeat steps 2-6 for each Lambda function within the current region.

Then repeat the Audit process for all other regions.

### Using AWS CLI

1. Run `aws lambda list-functions`

```bash
aws lambda list-functions --output table --query 'Functions[*].FunctionName'
```

This command will provide a table titled ListFunctions

2. Run `aws lambda get-function-configuration` using the Function names returned in the table.

```bash
aws lambda get-function-configuration --function-name "name_of_fuunction" --query 'Runtime'
```

3. The command output should return the execution environment.
4. Compare the function runtime with the updated list of Amazon Lambda runtimes. Link is in the resource section.
5. If the version you are using is not the latest or is on the EOL list, the selected Amazon Lambda function is using an old and deprecated runtime environment.
6. Refer to the remediation below.

## Expected Result

All Lambda functions use supported runtime versions that are not deprecated or on the end-of-life (EOL) list.

## Remediation

### Using AWS Console

1. Login to the AWS Console using https://console.aws.amazon.com/lambda/.
2. In the left column, under `AWS Lambda`, click `Functions`.
3. Under `Function name` click on the name of the function that you want to review
4. Click Code tab
5. Go to the Runtime settings section.
6. Click Edit
7. On the Edit runtime settings page, select the latest supported version of the runtime environment from the dropdown list.
   \*\*Note - make sure the correct architecture is also selected.
8. Click Save
9. Select the Code tab
10. Click Test from the Code source section.
11. Once the testing is completed, the execution result of your Lambda function will be listed
12. Repeat steps for each Lambda function that failed the Audit within the current region.

### Using AWS CLI

1. Run `aws lambda update-function-configuration` using the name of the Function you need to remediate

```bash
aws lambda update-function-configuration --output table --query 'Functions[*].FunctionName'
```

This command will provide a table titled ListFunctions

2. Run `aws lambda get-function-configuration` using the Function names returned in the table.

```bash
aws lambda get-function-configuration --function-name "name_of_fuunction" --function-name "name_of_function" --runtime "python3.9"
```

3. The command output should return the metadata available for the reconfigured function.
4. Repeat steps 1-2 to upgrade the runtime environment for each Amazon Lambda function found in the Audit.

## Default Value

Lambda functions use the runtime version specified at creation time. AWS does not automatically upgrade runtimes.

## References

1. https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 7.4 Perform Automated Application Patch Management - Perform application updates on enterprise assets through automated patch management on a monthly, or more frequent, basis.                                                        | x    | x    | x    |
| v7               | 3.5 Deploy Automated Software Patch Management Tools - Deploy automated software update tools in order to ensure that third-party software on all systems is running the most recent security updates provided by the software vendor. | x    | x    | x    |

## Profile

Level 1 | Manual
