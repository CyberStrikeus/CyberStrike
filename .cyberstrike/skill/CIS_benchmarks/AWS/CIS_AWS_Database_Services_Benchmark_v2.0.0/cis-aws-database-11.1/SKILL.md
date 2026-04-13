---
name: cis-aws-database-11.1
description: "Ensure to Implement Identity and Access Management (IAM)"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, qldb, ledger, iam, authentication, access-control]
cis_id: "11.1"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-11.2, cis-aws-database-11.3, cis-aws-database-11.5]
prerequisites: []
severity_boost: {}
---

# 11.1 Ensure to Implement Identity and Access Management (IAM) (Manual)

## Description

This control is important because by having IAM roles implemented in the database it only allows certain people who are authenticated into the database to modify the database and would not give access to unauthorized personnel. This ensures that the data is being protected from any threat actor.

## Rationale

IAM provides centralized authentication and authorization for QLDB resources, ensuring only authorized users and services can access the ledger database.

## Impact

Only authorized personnel can access the database and configure the applications by using their IAM credentials. If the user credentials are compromised by an unauthorized user, it would limit them to access specific areas within the database due to the leverage IAM roles established.

## Audit Procedure

### Using AWS Console

1. Understand IAM and QLDB Integration:
   - Familiarize yourself with IAM and its role in controlling access to AWS services, including QLDB.
   - Understand how IAM policies define permissions and access control rules for QLDB resources.
2. Define IAM Users and Groups:
   - Identify the users and groups that will need access to QLDB.
   - Create IAM user accounts for individuals who require direct access to QLDB.
   - Create IAM groups to organize users based on their roles or responsibilities logically.
3. Define IAM Policies:
   - Determine the permissions and actions users and groups need to perform on QLDB resources.
   - Create custom IAM policies or leverage existing IAM-managed policies to define these permissions.
   - Consider the principle of least privilege and grant only the necessary permissions for each user or group.
4. Attach IAM Policies to Users and Groups:
   - Associate the appropriate IAM policies with the IAM users and groups.
   - Ensure that each user or group has the necessary permissions to perform their tasks on QLDB.
   - Regularly review and update the assigned policies as access requirements evolve.
5. Leverage IAM Roles:
   - Identify AWS services or applications that require access to QLDB.
   - Create IAM roles to provide temporary credentials and permissions for these services.
   - Define trust relationships and establish the necessary permissions in the IAM role policies.
6. Enable IAM Database Authentication:
   - Configure IAM database authentication for QLDB to allow users to authenticate using their IAM credentials.
   - Enable the appropriate IAM authentication option in the QLDB configuration.
   - Configure your applications or clients to use IAM credentials when connecting to QLDB.
7. Test IAM Access:
   - Use IAM user credentials to log in and test the access to QLDB.
   - Verify that users can perform their intended actions based on their assigned IAM policies.
   - Test IAM roles and authentication for applications or services requiring access to QLDB.
8. Monitor and Audit IAM Activity:
   - Monitor IAM activity logs using AWS CloudTrail.
   - Set up appropriate CloudTrail trails to capture IAM-related events and API calls.
   - Regularly review IAM logs for any unauthorized access attempts or suspicious activities.
9. Regularly Review and Update IAM Configuration:
   - Periodically review the IAM policies, users, groups, and roles associated with QLDB.
   - Ensure access is granted based on business requirements and follows the principle of least privilege.
   - Remove or update IAM configurations when users or roles are no longer required.

## Expected Result

IAM users, groups, roles, and policies should be properly configured for QLDB access with the principle of least privilege applied. IAM database authentication should be enabled.

## Remediation

### Using AWS Console

Follow the audit steps above to implement IAM for your Amazon QLDB environment.

## Default Value

Access to QLDB is controlled through IAM. No default IAM policies are configured for QLDB access beyond the root account.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

Level 1 | Manual
