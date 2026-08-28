---
name: cis-aws-database-7.5
description: "Ensure to Implement Access Control and Authentication"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, documentdb, authentication, iam, access-control, users]
cis_id: "7.5"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-7.1, cis-aws-database-7.2, cis-aws-database-7.11]
prerequisites: []
severity_boost: {}
---

# 7.5 Ensure to Implement Access Control and Authentication (Manual)

## Description

Configure authentication mechanisms for your DocumentDB instances, such as using AWS Identity and Access Management (IAM) users or database users. Define appropriate user roles and permissions to control access to the DocumentDB instances and databases.

## Rationale

Proper authentication and access control mechanisms are essential to ensure that only authorized users and applications can access the DocumentDB cluster and its data.

## Impact

Implementing access control ensures that the principle of least privilege is followed, reducing the risk of unauthorized data access or modifications.

## Audit Procedure

### Using AWS Console

1. Sign into the AWS Management Console
   - Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon DocumentDB Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/docdb/.

3. Select the DocumentDB Cluster
   - Choose the Amazon DocumentDB cluster for which you want to implement access control and authentication.
   - Click on the cluster name to access its details page.
   - In the cluster details page, navigate to the "Configuration" section.

4. Enable Authentication
   - Under the `Network & Security` section.
   - Click on the `Edit` button or `Modify` option to configure the authentication settings.
   - Enable the option for authentication by choosing the appropriate setting.
   - DocumentDB supports authentication through username and password or through AWS Identity and Access Management (IAM) roles.

5. Configure Database Users
   - In the cluster details page, navigate to the `Users` or `Database users` section.
   - Click the `Add user` button to create a new database user.
   - Enter the username and password for the database user.
   - Assign appropriate permissions to the user, such as read-only or read-write access to specific databases or collections.

6. Save the Configuration
   - Click on `Save` button to apply the authentication and access control configuration.
   - DocumentDB will enforce authentication for connections to the cluster.

7. Test Authentication
   - Validate that your client applications or tools can connect to the DocumentDB cluster using the configured authentication credentials.
   - Ensure that the authentication process is successfully completed.

8. Monitor and Manage Access Control
   - Regularly monitor and manage the access control configuration for your DocumentDB cluster.
   - Review and update the permissions assigned to database users as needed.
   - Remove any unnecessary or unused database users to minimize security risks.

9. Consider IAM Authentication (Optional)
   - If desired, you can also configure IAM authentication for your DocumentDB cluster.
   - Follow the AWS documentation to set up IAM authentication for DocumentDB, if applicable.

## Expected Result

Authentication is enforced for all DocumentDB clusters with properly configured database users and appropriate role-based permissions.

## Remediation

### Using AWS Console

Follow the audit procedure steps to enable authentication, create database users with appropriate permissions, and optionally configure IAM authentication for each DocumentDB cluster.

## Default Value

Amazon DocumentDB requires authentication by default. A master username and password are required when creating a cluster.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | X    | X    | X    |
| v7               | 14.6 Protect Information through Access Control Lists | X    | X    | X    |

## Profile

Level 1 | Manual
