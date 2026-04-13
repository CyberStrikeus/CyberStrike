---
name: cis-aws-database-11.5
description: "Ensure to Implement Access Control and Authentication"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, qldb, ledger, access-control, iam, authentication]
cis_id: "11.5"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-11.1, cis-aws-database-11.4, cis-aws-database-11.6]
prerequisites: []
severity_boost: {}
---

# 11.5 Ensure to Implement Access Control and Authentication (Manual)

## Description

Utilize QLDB's built-in authentication and access control mechanisms. Define IAM policies to control which users or roles can perform specific actions on QLDB resources. Leverage IAM roles for cross-service access, securely integrating QLDB with other AWS services.

## Rationale

Users should select whether they like to enable authentication. If they want to authenticate the user would be required to implement IAM roles would grant or deny permissions within that database.

## Impact

Allowing authentication verifies the identity of the person and who has appropriate access to a company's data.

## Audit Procedure

### Using AWS Console

1. Understand QLDB Authentication and Access Control:
   - Familiarize yourself with the authentication and access control mechanisms provided by QLDB.
   - Understand the concepts of users, permissions, and roles in QLDB's access control model.
2. Configure IAM for QLDB:
   - Sign in to the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.
   - Open the Amazon QLDB console.
   - Go to the `Ledgers` section.
   - Select the QLDB ledger for which you want to configure access control.
   - Under the `Configuration` tab.
   - Click on `Edit` or `Modify` to make changes.
   - Enable IAM-based authentication by selecting the appropriate option.
   - Define the IAM policies that grant or deny permissions for specific QLDB actions.
   - Configure fine-grained access control by associating IAM policies with IAM users or roles.
3. Create IAM Users or Roles:
   - Identify the individuals or services that require access to QLDB.
   - Create IAM user accounts for individuals or IAM roles for services.
   - Assign appropriate IAM policies to these users or roles based on their required access levels.
4. Grant Required Permissions:
   - Define IAM policies that grant the necessary permissions for QLDB operations.
   - Consider the principle of least privilege and only provide the minimum permissions required for each user or role.
   - Assign IAM policies to IAM users or roles to allow access to specific QLDB resources.
5. Test Access Control:
   - Use IAM user credentials or IAM role credentials to test access to QLDB resources.
   - Verify that users or services can perform the expected actions based on their assigned IAM policies.
   - Test both read and write operations to ensure appropriate access permissions.
6. Monitor and Audit Access:
   - Enable AWS CloudTrail for QLDB to capture and log all API calls and activities.
   - Use Amazon CloudWatch to monitor and analyze the logs for unauthorized access attempts or suspicious activities.
   - Implement additional logging and auditing mechanisms as per your organization's security requirements.
7. Regularly Review and Update Access Control:
   - Conduct periodic reviews of IAM policies, users, and roles associated with QLDB.
   - Remove or update access for users or roles that no longer require QLDB access.
   - Stay updated with AWS security best practices and IAM and access control recommendations.

## Expected Result

IAM-based authentication should be enabled for QLDB with properly configured IAM policies, users, and roles following the principle of least privilege.

## Remediation

### Using AWS Console

Follow the audit steps above to implement access control and authentication for your Amazon QLDB ledgers.

## Default Value

QLDB access is controlled through IAM. Fine-grained access control policies must be manually configured.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

Level 1 | Manual
