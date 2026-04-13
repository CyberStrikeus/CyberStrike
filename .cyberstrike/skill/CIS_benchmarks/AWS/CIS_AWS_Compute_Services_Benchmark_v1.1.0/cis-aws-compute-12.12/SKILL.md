---
name: cis-aws-compute-12.12
description: "Ensure encryption in transit is enabled for Lambda environment variables"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lambda, serverless, encryption, transit, environment-variables, kms]
cis_id: "12.12"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-12.3, cis-aws-compute-12.11]
prerequisites: []
severity_boost: {}
---

# Ensure encryption in transit is enabled for Lambda environment variables

## Description
As you can set your own environmental variables for Lambda it is important to also encrypt them for in transit protection.

## Rationale
Lambda environment variables should be encrypted in transit for client-side protection as they can store sensitive information.

## Impact
Enabling encryption in transit adds encryption overhead and may require updates to Lambda function code to decrypt environment variables at runtime.

## Audit Procedure

### Using AWS Console
1. Login to the AWS Console using https://console.aws.amazon.com/lambda/.
2. In the left column, under `AWS Lambda`, click `Functions`.
3. Under `Function name` click on the name of the function that you want to review
4. Click the Configuration tab
5. In the left column, click `Environment variables`.
6. In the `Environment variables` section, click `Edit`
7. On the Edit environment variables page, review the Values. If they are a long value that resembles this:
   AQICAHhxbKJYcFAU16CbU4IVpzi5CwK
   Encryption is in place for that Key. If the value is in plain text refer to the remediation below.
8. Repeat steps 2 - 7 for each Lambda function available in the current AWS region.
9. Repeat this Audit for all the other AWS regions.

### Using AWS CLI
1. Run `aws lambda list-functions`

```bash
aws lambda list-functions --output table --query "Functions[*].FunctionName"
```

This command will provide a table titled ListFunctions

2. Run `aws lambda get-function`

```bash
aws lambda get-function --function-name "name_of_function" --query "Configuration.Environment"
```

This will provide an output of the environment variables created for that function.

3. Review the Values in the table. If they contain a long value that resembles this:
   AQICAHhxbKJYcFAU16CbU4IVpzi5CwK. Encryption is in place for that Key. If the value is in plain text refer to the remediation below.
4. Repeat steps 1 - 3 for each Lambda function listed in the current region.
5. Repeat this Audit for all the other AWS regions.

## Expected Result
All Lambda function environment variable values are encrypted in transit (values appear as encrypted ciphertext rather than plain text).

## Remediation

### Using AWS Console
1. Login to the AWS Console using https://console.aws.amazon.com/lambda/.
2. In the left column, under `AWS Lambda`, click `Functions`.
3. Under `Function name` click on the name of the function that you want to review
4. Click the Configuration tab
5. In the left column, click `Environment variables`.
6. In the `Environment variables` section, click `Edit`
7. Click the check box for `Enable helpers for encryption in transit`
8. Click the `Encrypt` option for all the variable that need to be encrypted.
9. Repeat steps 2 - 8 for each Lambda function identified in the Audit within the current AWS region.
10. Repeat this remediation for all the other AWS regions.

### Using AWS CLI
N/A - This control is Console-based remediation only.

## Default Value
Lambda environment variables are encrypted at rest by default using AWS managed keys, but encryption in transit (client-side encryption) is not enabled by default.

## References
1. https://docs.aws.amazon.com/lambda/latest/dg/welcome.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.10 Encrypt Sensitive Data in Transit - Encrypt sensitive data in transit. Example implementations can include: Transport Layer Security (TLS) and Open Secure Shell (OpenSSH). | | x | x |
| v8 | 3.11 Encrypt Sensitive Data at Rest - Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data. Storage-layer encryption, also known as server-side encryption, meets the minimum requirement of this Safeguard. Additional encryption methods may include application-layer encryption, also known as client-side encryption, where access to the data storage device(s) does not permit access to the plain-text data. | | x | x |
| v7 | 10.4 Ensure Protection of Backups - Ensure that backups are properly protected via physical security or encryption when they are stored, as well as when they are moved across the network. This includes remote backups and cloud services. | x | x | x |

## Profile
Level 1 | Manual
