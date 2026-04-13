---
name: cis-aws-database-6.3
description: "Ensure Authentication and Access Control is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, memorydb, redis, authentication, acl, access-control]
cis_id: "6.3"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-6.1, cis-aws-database-6.2, cis-aws-database-6.5]
prerequisites: []
severity_boost: {}
---

# 6.3 Ensure Authentication and Access Control is Enabled (Manual)

## Description

Ensure that authentication and access control are enabled for Amazon MemoryDB for Redis clusters to restrict access to authorized users only.

## Rationale

Users should select whether they like to enable authentication. If they want to authenticate a password would be required, which would only allow the authorized person to access the cluster. Defining access control allows specific workers in a business access to the database.

## Impact

Allowing authentication verifies the identity of the person and who has appropriate access to a company's data.

## Audit Procedure

### Using AWS Console

1. Sign into the AWS Management Console
   - Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon MemoryDB Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/memorydb/.

3. Select the Cluster
   - Choose the Amazon MemoryDB cluster on which you want to implement authentication and access control.
   - Click on the cluster name to access its details page.

4. Enable Authentication
   - In the cluster details page, navigate to the `Authentication` section.
   - Click on `Modify` to edit the authentication settings.
   - Select the desired authentication option:
     - No Authentication: This option allows unauthenticated access to your MemoryDB cluster.
     - Password Authentication: Choose this option to enable password-based authentication. Enter the desired password for the cluster.
   - Click `Apply Changes` to enable authentication for the MemoryDB cluster.

5. Define Access Control Policies
   - In the cluster details page, navigate to the "Access Control" section.
   - Click on `Modify` to edit the access control settings.
   - Define the access control policies based on your requirements:
     - For Redis-based clusters, you can use Redis Access Control Lists (ACLs) to control access at the Redis command level.
     - Use the Redis commands to create, modify, or delete ACL rules as needed.
     - You can define rules based on IP addresses, users, or patterns to allow or deny specific commands or operations.
   - Click `Apply Changes` to save the access control policies for the MemoryDB cluster.

6. Test Authentication and Access Control
   - Use a Redis client or utility to connect to your Amazon MemoryDB cluster.
   - Provide the necessary authentication credentials, such as the password, if password-based authentication is enabled.
   - Test the connection and verify that you can access the MemoryDB cluster based on the defined access control policies.

7. Regularly Review and Update Access Control
   - Periodically review the access control policies to ensure they align with your security requirements.
   - Update the ACL rules, passwords, or other authentication mechanisms to adapt to changing access requirements or security policies.

## Expected Result

Authentication is enabled (password or ACL-based) and access control policies are properly configured for all MemoryDB clusters.

## Remediation

### Using AWS Console

Follow the audit procedure steps to enable authentication and configure access control policies for each MemoryDB cluster.

## Default Value

Amazon MemoryDB for Redis requires authentication by default using Access Control Lists (ACLs).

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | X    | X    | X    |
| v7               | 14.6 Protect Information through Access Control Lists | X    | X    | X    |

## Profile

Level 1 | Manual
