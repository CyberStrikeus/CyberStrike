---
name: cis-aws-compute-12.10
description: "Ensure Lambda functions do not allow unknown cross account access via permission policies"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lambda, serverless, cross-account, access-control, resource-policy]
cis_id: "12.10"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-12.4, cis-aws-compute-12.6, cis-aws-compute-12.9]
prerequisites: []
severity_boost: {}
---

# Ensure Lambda functions do not allow unknown cross account access via permission policies

## Description
Ensure that all your Amazon Lambda functions are configured to allow access only to trusted AWS accounts in order to protect against unauthorized cross-account access.

## Rationale
Allowing unknown (unauthorized) AWS accounts to invoke your Amazon Lambda functions can lead to data exposure and data loss. To prevent any unauthorized invocation requests for your Lambda functions, restrict access only to trusted AWS accounts.

## Impact
Restricting cross-account access may break existing integrations with partner or trusted accounts. Ensure all legitimate cross-account relationships are documented before restricting access.

## Audit Procedure

### Using AWS Console
1. Login to the AWS Console using https://console.aws.amazon.com/lambda/.
2. In the left column, under `AWS Lambda`, click `Functions`.
3. Under `Function name` click on the name of the function that you want to review
4. Click the Configuration tab
5. In the left column, click `Permissions`.
6. In the `Resource-based policy statements` section, click `View policy document`
7. Review the Resource-based policy document box. Find the "Principal" element and check the element value (ARN).
8. Confirm that each AWS account ARN is an approved AWS account. If one or more of the ARNs is not an AWS account defined within your organization, refer to the remediation below.
9. Repeat steps no. 2-8 for each Lambda function available within the current AWS region.
10. Repeat this Audit for all the other AWS regions.

### Using AWS CLI
1. Run `aws lambda list-functions`

```bash
aws lambda list-functions --output table --query "Functions[*].FunctionName"
```

2. This command will provide a table titled ListFunctions

3. Run `aws lambda get-policy` on the functions listed

```bash
aws lambda get-policy --function-name "name_of_function" --output text --query "Policy"
```

4. This will provide an output of the policy assigned to that function.
5. Identify the "Principal" element for each function for the ARN.
6. Confirm that each AWS account ARN is an approved AWS account. If one or more of the ARNs is not an AWS account defined within your organization, refer to the remediation below.
7. Repeat steps 2-5 for each Lambda function available.
8. Run the Audit in the other AWS cloud regions.

## Expected Result
All Lambda function resource-based policies contain only Principal ARNs belonging to trusted and approved AWS accounts within the organization.

## Remediation

### Using AWS Console
1. Login to the AWS Console using https://console.aws.amazon.com/lambda/.
2. In the left column, under `AWS Lambda`, click `Functions`.
3. Under `Function name` click on the name of the function that you want to review
4. Click the Configuration tab
5. In the left column, click `Permissions`.
6. In the `Resource-based policy statements` section, select the policy statement that allows the unknown AWS Account cross-account access
7. Click Edit
8. On the `Edit permissions` page, replace or remove the AWS Account(s) ARN of the unauthorized principal in the Principal box
9. Click Save
10. Repeat steps for each Lambda function that failed the Audit

### Using AWS CLI
N/A - This control is Console-based remediation only.

## Default Value
Lambda functions do not allow cross-account access by default. Cross-account access requires explicit configuration of resource-based policies.

## References
1. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/lambda/index.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 6.8 Define and Maintain Role-Based Access Control - Define and maintain role-based access control, through determining and documenting the access rights necessary for each role within the enterprise to successfully carry out its assigned duties. Perform access control reviews of enterprise assets to validate that all privileges are authorized, on a recurring schedule at a minimum annually, or more frequently. | | | x |
| v7 | 1.7 Deploy Port Level Access Control - Utilize port level access control, following 802.1x standards, to control which devices can authenticate to the network. | | x | x |

## Profile
Level 1 | Manual
