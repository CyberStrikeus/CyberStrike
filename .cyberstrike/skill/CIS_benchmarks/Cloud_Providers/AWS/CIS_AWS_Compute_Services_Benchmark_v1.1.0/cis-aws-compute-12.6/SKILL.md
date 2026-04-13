---
name: cis-aws-compute-12.6
description: "Ensure Lambda functions are not exposed to everyone"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lambda, serverless, public-access, permissions, resource-policy]
cis_id: "12.6"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-12.4, cis-aws-compute-12.9, cis-aws-compute-12.10]
prerequisites: []
severity_boost: {}
---

# Ensure Lambda functions are not exposed to everyone

## Description

A publicly accessible Amazon Lambda function is open to the public and can be reviewed by anyone. To protect against unauthorized users that are sending requests to invoke these functions they need to be changed so they are not exposed to the public.

## Rationale

Allowing anyone to invoke and run your Amazon Lambda functions can lead to data exposure, data loss, and unexpected charges on your AWS bill.

## Impact

Restricting public access may break existing integrations that rely on anonymous invocation of Lambda functions.

## Audit Procedure

### Using AWS Console

1. Login to the AWS Console using https://console.aws.amazon.com/lambda/.
2. In the left column, under `AWS Lambda`, click `Functions`.
3. Under `Function name` click on the name of the function that you want to review
4. Click the Configuration tab
5. In the left column, click `Permissions`.
6. In the `Resource-based policy` section, click `View policy document`
7. Review the Resource-based policy document box. Find the "Principal" element defined for each policy statement and check the element value. If the element has one of the following values: "" or { "AWS": "" }, it means it is set to "Allow", and if it does not contain a "Condition" clause to filter the access, the selected Amazon Lambda function is set to anonymous access.
8. If any of the Lambda functions have anonymous access set refer to the remediation below.
9. Repeat steps 2 - 7 for each Lambda function available within the current AWS region.
10. Repeat this Audit for all the other AWS regions.

### Using AWS CLI

1. Run `aws lambda list-functions`

```bash
aws lambda list-functions --output table --query "Functions[*].FunctionName"
```

This command will provide a table titled ListFunctions

2. Run `aws lambda get-policy`

```bash
aws lambda get-policy --function-name "name_of_function" --output text --query "Policy"
```

This will provide an output of the policy assigned to that function.

3. Find the "Principal" element defined for that function. If the element has one of the following values: "" or { "AWS": "" }, it means it is set to "Allow", and if it does not contain a "Condition" clause to filter the access, the selected Amazon Lambda function is set to anonymous access.
4. Make note of the Function name from step 1 and the Statement name from step 2 and refer to the remediation steps below.
5. Repeat steps 1 - 3 for each Lambda function listed within the current region.
6. Repeat this Audit for all the other AWS regions.

## Expected Result

No Lambda function has a resource-based policy that allows anonymous or public access (Principal set to "_" or {"AWS": "_"} without a Condition clause).

## Remediation

### Using AWS Console

1. Login to the AWS Console using https://console.aws.amazon.com/lambda/.
2. In the left column, under `AWS Lambda`, click `Functions`.
3. Under `Function name` click on the name of the function that you want to review
4. Click the Configuration tab
5. In the left column, click `Permissions`.
6. In the `Resource-based policy` section, perform the following actions:
   - Under Policy statements
   - Select the policy statement that allows anonymous access
   - Click Delete to remove the non-compliant statement from the resource-based policy attached
   - Within the Delete statement confirmation box, click Remove
   - Click Add permissions to add a new policy statement that grants permissions to a trusted entity only.
   - On the Add permissions page configure the new policy statement to grant access to another AWS account, IAM user, IAM role, or to another AWS service.
   - Click Save
7. Repeat steps no. 2 - 6 for each Lambda function that fails the Audit above, within the current region.
8. Repeat this Audit for all the other AWS regions.

### Using AWS CLI

1. Run `aws lambda remove-permission`

```bash
aws lambda remove-permission --function-name "name_of_function" --statement-id "SID_of_Statement"
```

This command will remove the access policy that is failing the audit for that function.

2. Run `aws lambda add-permission`

```bash
aws lambda add-permission --function-name "name_of_function" --statement-id "correctaccess" --principal "012345678910" --action lambda:InvokeFunction
```

This adds a new policy to the function.

\*\*\*Note The --principal parameter can be the ID of the trusted AWS account, another AWS account, IAM user, IAM role, or another AWS service.

3. The command output should display the new policy created.
4. Repeat steps 1-2 for each Lambda function from the audit for all regions.

## Default Value

Lambda functions are not publicly accessible by default. Public access requires explicit configuration of resource-based policies.

## References

1. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/lambda/index.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 1.2 Address Unauthorized Assets - Ensure that a process exists to address unauthorized assets on a weekly basis. The enterprise may choose to remove the asset from the network, deny the asset from connecting remotely to the network, or quarantine the asset. | x    | x    | x    |
| v7               | 1.6 Address Unauthorized Assets - Ensure that unauthorized assets are either removed from the network, quarantined or the inventory is updated in a timely manner.                                                                                                | x    | x    | x    |
| v7               | 2.6 Address unapproved software - Ensure that unauthorized software is either removed or the inventory is updated in a timely manner.                                                                                                                             | x    | x    | x    |

## Profile

Level 1 | Manual
