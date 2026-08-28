---
name: cis-aws-compute-12.5
description: "Ensure every Lambda function has its own IAM Role"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lambda, serverless, iam, execution-role, least-privilege]
cis_id: "12.5"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-12.4, cis-aws-compute-12.7, cis-aws-compute-12.9]
prerequisites: []
severity_boost: {}
---

# Ensure every Lambda function has its own IAM Role

## Description

Every Lambda function should have a one to one IAM execution role and the roles should not be shared between functions.

## Rationale

The Principle of Least Privilege means that any Lambda function should have the minimal amount of access required to perform its tasks. In order to accomplish this Lambda functions should not share IAM Execution roles.

## Impact

Creating unique IAM roles for each Lambda function increases the number of IAM roles to manage but provides better security isolation between functions.

## Audit Procedure

### Using AWS Console

1. Login to the AWS console using https://console.aws.amazon.com/lambda/
2. In the left column, under `AWS Lambda`, click `Functions`.
3. Under `Function name` click on the name of the function that you want to review.
4. Click the `Configuration` tab
5. Under General configuration on the left column, click `Permissions`.
6. Under the `Execution role` section, `Role name` not the name listed as this is the IAM is the role that defines the access permissions for the selected function.
7. Repeat steps 2 - 6 for all the Lambda functions listed within the AWS region.
8. If any Lambda functions share the same Execution role, refer to the remediation below.
9. Repeat this Audit for all the AWS Regions.

### Using AWS CLI

N/A - This control is Console-based audit only.

## Expected Result

Each Lambda function has a unique IAM execution role that is not shared with any other Lambda function.

## Remediation

### Using AWS Console

1. Login to the AWS console using https://console.aws.amazon.com/lambda/
2. In the left column, under `AWS Lambda`, click `Functions`.
3. Under `Function name` click on the name of the function that you want to change/update.
4. Click the `Configuration` tab
5. Under General configuration on the left column, click `Permissions`.
6. Under the `Execution role` section, click `Edit`.
7. Scroll down to `Execution role`

**To use an existing IAM role:**

- Click `Use an existing role`
- Select the role from the `Existing role` dropdown.
- The IAM role can't be associated with another Lambda function and must follow the Principle of Least Privilege.

**To use a new IAM role:**

- Click `Create a new role from AWS policy templates`
- Provide a unique name based on company policy in the `Role name`
- Select the policy templates from the `Policy templates` dropdown.

8. Click `Save`
9. Repeat steps 2 - 8 for all the Lambda functions listed within the AWS region that do not have a unique IAM Execution Role.
10. Repeat this remediation process for all the AWS Regions.

### Using AWS CLI

N/A - This control is Console-based remediation only.

## Default Value

When creating a Lambda function, AWS creates a default execution role, but multiple functions can be configured to share the same role.

## References

1. https://docs.aws.amazon.com/lambda/latest/dg/welcome.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                        | x    | x    | x    |
| v7               | 8.3 Enable Operating System Anti-Exploitation Features/Deploy Anti-Exploit Technologies - Enable anti-exploitation features such as Data Execution Prevention (DEP) or Address Space Layout Randomization (ASLR) that are available in an operating system or deploy appropriate toolkits that can be configured to apply protection to a broader set of applications and executables. |      | x    | x    |

## Profile

Level 1 | Manual
