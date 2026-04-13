---
name: cis-aws-database-9.4
description: "Ensure Authentication and Access Control is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, neptune, graph-database, iam, authentication, access-control]
cis_id: "9.4"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-9.1, cis-aws-database-9.5, cis-aws-database-9.6]
prerequisites: []
severity_boost: {}
---

# 9.4 Ensure Authentication and Access Control is Enabled (Manual)

## Description
This helps ensure that there are specific IAM roles and policies that are given the necessary information within a Neptune DB cluster to operate as needed.

## Rationale
IAM authentication and access control verifies the identity of users and services, ensuring only authorized entities can access Neptune resources.

## Impact
Allowing authentication verifies the identity of the person and who has appropriate access to a company's data.

## Audit Procedure

### Using AWS Console
1. Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.
2. Open the Amazon Neptune Console - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/neptune/.
3. Select the Neptune Cluster:
   - Choose the Amazon Neptune cluster on which you want to implement authentication and access control.
   - Click on the cluster name to access its details page.
4. Enable IAM Database Authentication:
   - In the cluster details page, navigate to the `Configuration` or `Database Authentication` section.
   - Under `Database Authentication`, select the option to enable IAM database authentication.
   - Click `Apply Changes` to enable IAM database authentication for the Neptune cluster.
5. Configure IAM Roles and Policies:
   - Open the AWS Identity and Access Management (IAM) console by navigating to `IAM` in the AWS Management Console.
   - Create IAM roles and policies that define the desired access control for your Neptune resources.
   - Assign the necessary permissions to the IAM roles to allow specific actions on the Neptune cluster, such as read, write, or manage operations.
   - Associate the IAM roles with the appropriate users, groups, or AWS services that need access to the Neptune cluster.
6. Test IAM Database Authentication:
   - Update your client applications or tools to use IAM database authentication when connecting to the Neptune cluster.
   - Configure your applications to assume the necessary IAM roles before establishing a connection to Neptune.
   - Test the connection from your client application to the Neptune cluster to verify that IAM database authentication is working as expected.
   - Ensure that users or services are authenticated and authorized based on the IAM roles and policies defined.
7. Regularly Review and Update IAM Roles and Policies:
   - Periodically review your IAM roles and policies to ensure they align with your security requirements and access control needs.
   - Make necessary updates to IAM roles and policies to adapt to changes in user access requirements or organizational security policies.
   - Follow the principle of least privilege and ensure that users or services have only the necessary permissions to perform their required actions on the Neptune cluster.

## Expected Result
IAM database authentication should be enabled for the Neptune cluster, with properly configured IAM roles and policies following the principle of least privilege.

## Remediation

### Using AWS Console
Follow the audit steps above to enable IAM database authentication and configure appropriate IAM roles and policies for your Neptune cluster.

## Default Value
IAM database authentication is not enabled by default for Neptune clusters.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## Profile
Level 1 | Manual
