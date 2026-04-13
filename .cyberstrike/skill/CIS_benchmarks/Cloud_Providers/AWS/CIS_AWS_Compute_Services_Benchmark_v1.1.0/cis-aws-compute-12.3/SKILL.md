---
name: cis-aws-compute-12.3
description: "Ensure AWS Secrets manager is configured and being used by Lambda for databases"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lambda, serverless, secrets-manager, credentials, database]
cis_id: "12.3"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-12.4, cis-aws-compute-12.12]
prerequisites: []
severity_boost: {}
---

# Ensure AWS Secrets manager is configured and being used by Lambda for databases

## Description

Lambda functions often have to access a database or other services within your environment.

## Rationale

Credentials used to access databases and other AWS Services need to be managed and regularly rotated to keep access into critical systems secure. Keeping any credentials and manually updating the passwords would be cumbersome, but AWS Secrets Manager allows you to manage and rotate passwords.

## Impact

Lambda code should be checked for correct configuration to get the credentials from AWS Secrets Manager. This audit and remediation is only to confirm you have the credentials in Secrets manager.

## Audit Procedure

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Secrets Manager` under Security, Identity and Compliance.
3. Click on `Secrets`.
4. Review the secrets listed
5. Confirm that the secret required for Lambda functions is included in the list.
6. If it is, review your code and confirm that you are calling the credentials during runtime.
7. If the credentials are not listed refer to the remediation below.
8. Repeat steps 2-7 for all regions used.

### Using AWS CLI

N/A - This control is Console-based audit only.

## Expected Result

All database credentials used by Lambda functions are stored in AWS Secrets Manager and Lambda code retrieves credentials from Secrets Manager at runtime.

## Remediation

### Using AWS Console

1. Login to AWS Console using https://console.aws.amazon.com
2. Click `All services`, click `Secrets Manager` under Security, Identity and Compliance.
3. Click on `Secrets`.
4. Click on `Store a new secret`
5. Select the `Secret type`
6. Enter the information

For the 3 db types listed enter the credentials and select the database.
For `other database` enter the credentials, select the db type and enter the connection parameters.

For `Other type of secret` (Lambda) create the keys and values used. - example Username yepyep Password yepyep
Choose an encryption key or create a new one. If you add a new key it will take you to the KMS console. Once you create the new key you can then select it here.

7. Click `Next`
8. Give the secret a name associated with your organization style and lambda
9. Click `Next`
10. Configure the auto rotation

```
Rotation schedule leave as default
Select the lambda function you use to rotate the key
```

11. Click `Next`
12. Review all the settings
13. Click `Store`

### Using AWS CLI

N/A - This control is Console-based remediation only.

## Default Value

AWS Secrets Manager is not configured by default for Lambda functions.

## References

1. https://aws.amazon.com/blogs/security/how-to-securely-provide-database-credentials-to-lambda-functions-by-using-aws-secrets-manager/
2. https://docs.aws.amazon.com/lambda/latest/dg/welcome.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 2.5 Allowlist Authorized Software - Use technical controls, such as application allowlisting, to ensure that only authorized software can execute or be accessed. Reassess bi-annually, or more frequently.                                     |      | x    | x    |
| v8               | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | x    | x    | x    |
| v7               | 1.7 Deploy Port Level Access Control - Utilize port level access control, following 802.1x standards, to control which devices can authenticate to the network.                                                                                 |      | x    | x    |
| v7               | 4.2 Change Default Passwords - Before deploying any new asset, change all default passwords to have values consistent with administrative level accounts.                                                                                       | x    | x    | x    |

## Profile

Level 1 | Manual
