---
name: cis-aws-compute-12.9
description: "Ensure there are no Lambda functions with admin privileges within your AWS account"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, lambda, serverless, iam, admin-privileges, least-privilege, over-permission]
cis_id: "12.9"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-12.4, cis-aws-compute-12.5, cis-aws-compute-12.10]
prerequisites: []
severity_boost: {}
---

# Ensure there are no Lambda functions with admin privileges within your AWS account

## Description
Ensure that your Amazon Lambda functions don't have administrative permissions potentially giving the function access to all AWS cloud services and resources.

## Rationale
In order to promote the Principle of Least Privilege (POLP) and provide your functions the minimal amount of access required to perform their tasks the right IAM execution role associated with the function should be used. Instead of providing administrative permissions you should grant the role the necessary permissions that the function really needs.

## Impact
Removing admin privileges from Lambda execution roles may break functions that rely on broad permissions. Functions should be tested after permission changes.

## Audit Procedure

### Using AWS Console
1. Login in to the AWS Console using https://console.aws.amazon.com/lambda/
2. In the left column, under `AWS Lambda`, click `Functions`.
3. Under `Function name` click on the name of the function that you want to review
4. Click the Configuration tab
5. Click on `Permissions` in the left column.
6. In the Execution role section, click the `Role name` to access the IAM role details.
   **Note this will bring you to the IAM Console.
7. Select the Permissions tab to view the identity-based policies attached
8. In the Permissions policies section click on the Policy name.
9. Select the Permissions tab.
   **Note The policy summary should show below in JSON format.
10. Within the {} JSON policy, identify the "Action" element defined for each statement and check the value.
11. If any of the "Action" element values are set to "*" and the "Effect" element is set to "Allow", the role policy provides access to all the supported AWS cloud services and resources.
12. Repeat this step for each IAM policy attached to the selected execution role.

If one or more policies allow access to all AWS services and resources, the execution role provides administrative permissions. Refer to the remediation below.
Repeat steps for each Lambda function within the current region.
Then repeat the Audit process for all other regions.

### Using AWS CLI
N/A - This control requires manual review of IAM policies through the Console.

## Expected Result
No Lambda function execution role has policies with "Action": "*" and "Effect": "Allow", ensuring no function has administrative privileges.

## Remediation

### Using AWS Console
1. Login in to the AWS Console using https://console.aws.amazon.com/lambda/
2. In the left column, under `AWS Lambda`, click `Functions`.
3. Under `Function name` click on the name of the function you want to remediate
4. Click the Configuration tab
5. Click on `Permissions` in the left column.
6. In the Execution role section, click the `Edit`
7. Edit basic settings configuration page:

**Associate the function with an existing, compliant IAM role:**
- click Use an existing role from the Execution role
- select the required role from the Existing role dropdown
- click Save

**OR apply a new execution role to your Lambda function:**
- click Create a new role from AWS policy templates
- Provide a name for the new role based on org policy
- select only the necessary permission set(s) from the Policy templates - optional dropdown list.
- click Save

8. Repeat steps for each Lambda function within the current region that failed the Audit.

### Using AWS CLI
N/A - This control is Console-based remediation only.

## Default Value
Lambda functions are not created with administrative privileges by default, but users may attach overly permissive policies to execution roles.

## References
1. https://docs.aws.amazon.com/lambda/latest/dg/welcome.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 6.8 Define and Maintain Role-Based Access Control - Define and maintain role-based access control, through determining and documenting the access rights necessary for each role within the enterprise to successfully carry out its assigned duties. Perform access control reviews of enterprise assets to validate that all privileges are authorized, on a recurring schedule at a minimum annually, or more frequently. | | | x |
| v7 | 1.7 Deploy Port Level Access Control - Utilize port level access control, following 802.1x standards, to control which devices can authenticate to the network. | | x | x |

## Profile
Level 1 | Manual
