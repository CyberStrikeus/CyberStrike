---
name: cis-aws-database-5.8
description: "Ensure Authentication and Access Control is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, elasticache, redis, authentication, access-control, iam, acl]
cis_id: "5.8"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-5.1, cis-aws-database-5.7]
prerequisites: []
severity_boost: {}
---

# 5.8 Ensure Authentication and Access Control is Enabled

## Description
Individual creates IAM roles that would give specific permission to what the user can and cannot do within that database. The Access Control List (ACLs) allows only specific individuals to access the resources.

## Rationale
N/A

## Impact
Use specific client's applications or tools that allow the authorized personnel to connect to the database.

## Audit Procedure

### Using AWS Console
1. Sign in to the AWS Management Console
   - Sign in to the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon Keyspaces Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/keyspaces/.

3. Select the Keyspace
   - Choose the Keyspace (database) for which you want to implement authentication and access control.
   - Click on the Keyspace name to access its details page.

4. Enable IAM for Cassandra
   - In the Keyspace details page, click on the `Configuration` tab.
   - Under the `Authentication and access control` section, locate the "IAM for Cassandra" option.
   - Click on `Edit`.
   - Select the `Enable` option to enable IAM for Cassandra authentication and authorization.
   - Choose the IAM role(s) that can access the Keyspace.
   - Click `Save` to enable IAM for Cassandra.

5. Define IAM Roles and Permissions
   - Open the IAM console by navigating to `Identity and Access Management (IAM)` in the AWS Management Console.
   - Create IAM roles with appropriate policies defining the desired access level to your Amazon Keyspaces resources.
   - You may create different roles for different user groups or applications.
   - Ensure that the IAM policies associated with these roles allow the necessary permissions for interacting with Keyspaces.
   - Attach the IAM roles to the appropriate AWS identities, such as IAM users or AWS Identity and Access Management roles.

6. Review and Update Access Control
   - In the Keyspace details page, click on the `Configuration` tab.
   - Under the `Authentication and access control` section, click on `Access Control Lists` (ACLs).
   - Review the ACLs to define fine-grained access control at the table and row level.
     - Define rules that allow or deny access based on specific conditions, such as IP addresses or IAM roles.
     - Ensure that the ACL rules align with your security requirements and restrict access to sensitive data if necessary.
   - Update the ACLs as needed to accommodate changes.

7. Verify Authentication and Access Control
   - Test the authentication and access control mechanisms using client applications or tools that connect to your Amazon Keyspaces resources.
   - Verify that only authorized users or applications can access the Keyspaces resources based on the defined IAM roles and ACL rules.
   - Monitor the access logs and perform periodic reviews to ensure the authentication and access control measures function as intended.

## Expected Result
IAM authentication is enabled for ElastiCache/Keyspaces, IAM roles have least-privilege access, and ACLs are properly configured to restrict access to authorized users only.

## Remediation

### Using AWS Console
Follow the same steps as the audit procedure to enable authentication and configure access control for ElastiCache clusters.

## Default Value
By default, IAM for Cassandra authentication is not enabled and ACLs are not configured.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## Profile
Level 1 | Manual
