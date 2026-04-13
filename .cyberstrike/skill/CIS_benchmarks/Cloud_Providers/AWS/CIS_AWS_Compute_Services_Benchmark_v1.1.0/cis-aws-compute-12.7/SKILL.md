---
name: cis-aws-compute-12.7
description: "Ensure Lambda functions are referencing active execution roles"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lambda, serverless, iam, execution-role, active-role]
cis_id: "12.7"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-12.4, cis-aws-compute-12.5, cis-aws-compute-12.9]
prerequisites: []
severity_boost: {}
---

# Ensure Lambda functions are referencing active execution roles

## Description

In order to have the necessary permissions to access the AWS cloud services and resources Amazon Lambda functions should be associated with active(available) execution roles.

## Rationale

A Lambda function's execution role is an Identity and Access Management (IAM) role that grants the function permission to process and access specific AWS services and resources. When Amazon Lambda functions are not referencing active execution roles, the functions are losing the ability to perform critical operations securely.

## Impact

Functions referencing inactive or deleted execution roles will fail to execute properly, potentially causing service disruptions.

## Audit Procedure

### Using AWS Console

1. Login to the AWS Console using https://console.aws.amazon.com/lambda/.
2. In the left column, under `AWS Lambda`, click `Functions`.
3. Under `Function name` click on the name of the function that you want to review
4. Click the Configuration tab
5. In the left column, click `Permissions`.
6. In the `Resource summary` section, if it reads "The role with name <role_name> cannot be found. (Service: LambdaConsole; Status Code: 404; Error Code: NoSuchEntity; Request ID: e3f12a73-2988-4dd5-b2d1-237c800a27f4; Proxy: null) refer to the remediation below.
7. Repeat steps 2 - 6 for each Lambda function available within the current AWS region.
8. Repeat this Audit for all the other AWS regions.

### Using AWS CLI

1. Run `aws lambda list-functions`

```bash
aws lambda list-functions --output table --query "Functions[*].FunctionName"
```

This command will provide a table titled ListFunctions

2. Run `aws lambda get-function`

```bash
aws lambda get-function --function-name "name_of_function" --query "Configuration.Role"
```

This will provide an output returning the role ARN assigned to that function.

3. Run `aws iam get-role`

```bash
aws iam get-role --role-name "name_of_role"
```

This will return the requested configuration information.

4. The command output should return the requested configuration information.
5. If the command output returns a `An error occurred (NoSuchEntity) when calling the GetRole operation` error message instead of the role's configuration, the execution role associated with the selected Lambda function is no longer available. Refer to the remediation below.
6. Repeat steps 1-5 for each Lambda function available in the selected AWS region.

Perform the Audit process for other regions.

## Expected Result

All Lambda functions reference active, existing IAM execution roles. The `aws iam get-role` command returns valid role configuration for each referenced role.

## Remediation

### Using AWS Console

1. Login to the AWS Console using https://console.aws.amazon.com/lambda/.
2. In the left column, under `AWS Lambda`, click `Functions`.
3. Under `Function name` click on the name of the function that you want to update.
4. Click the Configuration tab
5. In the left column, click `Permissions`.
6. In the `Execution role` section, click Edit
7. In the `Edit basic settings` page, perform one of the following actions:

**To use an existing role:**

- Click Use an existing role if you already a execution role for the selected Lambda function.
- Select the IAM role from the `Existing role` dropdown list.
- Click Save.

**Or to create a custom role:**

- Click To create a custom role, go to the `IAM console`.
- Click AWS Service
- Click `Lambda`.
- Click `Next: Permissions`
- Attach the permission policies needed
- Click Next: Tags
- Add tags (optional) based on your Organizational policy
- Click Next: Review
- Enter a Role name and a Role description so you can attach the policy to the Lambda function
- Click `Create role`
- Refresh the Edit basic settings page
- Select the new IAM role you just created from the `Existing role` dropdown list.
- Click Save.

8. Repeat steps 2 - 7 to update the execution role for each misconfigured Amazon Lambda function within the current AWS region.
9. Repeat this Audit for all the other AWS regions.

### Using AWS CLI

N/A - This control is Console-based remediation only.

## Default Value

Lambda functions are created with valid execution roles, but roles may be deleted independently of the function.

## References

1. https://docs.aws.amazon.com/lambda/latest/dg/welcome.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | x    | x    | x    |
| v7               | 1.7 Deploy Port Level Access Control - Utilize port level access control, following 802.1x standards, to control which devices can authenticate to the network.                                                                                 |      | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists.                                              | x    | x    | x    |
| v7               | 14.7 Enforce Access Control to Data through Automated Tools - Use an automated tool, such as host-based Data Loss Prevention, to enforce access controls to data even when data is copied off a system.                                         |      |      | x    |

## Profile

Level 1 | Manual
