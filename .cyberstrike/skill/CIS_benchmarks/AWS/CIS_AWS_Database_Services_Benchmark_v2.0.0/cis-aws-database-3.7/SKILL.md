---
name: cis-aws-database-3.7
description: "Ensure to Implement Access Control and Authentication"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, rds, access-control, authentication, iam]
cis_id: "3.7"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-3.4, cis-aws-database-3.13]
prerequisites: []
severity_boost: {}
---

# 3.7 Ensure to Implement Access Control and Authentication (Manual)

## Description

Users should select whether they like to enable authentication. If they want to authenticate a password would be required, which would only allow the authorized person to access the database. Defining access control allows specific workers in a business access to the database.

## Rationale

Implementing proper access control and authentication ensures that only authorized users can access the database, reducing the risk of unauthorized data access or modification.

## Impact

Proper access control restricts database access to authorized users only, preventing unauthorized access and potential data breaches.

## Audit Procedure

### Using AWS Console

1. Sign into the AWS Management Console
   - Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon RDS Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/rds/.

3. Select the RDS Instance
   - Choose the Amazon RDS instance you want to implement access control and authentication.
   - Click on the instance name to access its details page.
   - In the instance details page, navigate to the `Configuration` or `Connectivity & Security` section.

4. Enable IAM Database Authentication
   - Under the `Connectivity` or `Connectivity & Security` section.
   - Click the `Modify` or `Edit` option to enable IAM Database Authentication.
   - Select the option to enable IAM Database Authentication.
   - Click `Continue` or `Save` to apply the changes.

5. Create and Configure IAM Database Users
   - Click `Users` in the left-side menu in the Amazon RDS console.
   - Click `Create database user` to create a new IAM database user.
   - Provide a username and select the IAM role or IAM user that will be associated with the database user.
   - Configure the authentication type, either `Password-based` or `IAM authentication`.
   - Set the desired password or leave it blank for IAM authentication.
   - Configure the database user's privileges and permissions based on your application's requirements.
   - Click `Create` to create the IAM database user.

6. Configure Database User Privileges
   - Click `Users` in the left-side menu in the Amazon RDS console.
   - Select the database user you created in the previous step.
   - Click on `Modify` to modify the user's settings and permissions.
   - Configure the user's access privileges, including database access, object permissions, and privileges.
   - Click `Save` or `Apply Changes` to update the user's privileges.

7. Test Access and Authentication
   - Test the access and authentication by connecting to the RDS instance using the IAM database user's credentials or IAM role.
   - Verify that the authentication and access control mechanisms are functioning correctly.

8. Monitor and Manage IAM Database Users
   - Regularly monitor and review the IAM database users and their access privileges.
   - Adjust user privileges as needed based on changes in your application requirements.
   - Remove or disable database users when they are no longer needed.

## Expected Result

IAM Database Authentication should be enabled, and database users should have properly configured access privileges following the principle of least privilege.

## Remediation

### Using AWS Console

Follow the audit steps above to enable IAM Database Authentication and configure proper user privileges. Review and remove any unnecessary database users or excessive privileges.

## Default Value

IAM Database Authentication is disabled by default. Password-based authentication is the default authentication method.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

Level 1 | Manual
