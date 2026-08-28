---
name: cis-aws-database-10.5
description: "Ensure Fine-Grained Access Control is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, timestream, time-series, access-control, iam, fine-grained]
cis_id: "10.5"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-10.4, cis-aws-database-10.6, cis-aws-database-10.7]
prerequisites: []
severity_boost: {}
---

# 10.5 Ensure Fine-Grained Access Control is Enabled (Manual)

## Description

Leverage Timestream's fine-grained access control capabilities to control table or row level access. Define access policies that limit access to specific tables, columns, or rows based on user roles or conditions. Implement data filtering and row-level security to restrict access to sensitive information.

## Rationale

This helps by having specific permissions which can be denied due to multiple conditions of the database. This allows the user to control certain aspects of the database.

## Impact

This adds an extra layer for users to sign into with their credentials to the database.

## Audit Procedure

### Using AWS Console

1. Understand Fine-Grained Access Control in Timestream:
   - Familiarize yourself with the concept of fine-grained access control and its benefits in Timestream. Understand that fine-grained access control allows you to control access to specific tables, columns, or rows within Timestream databases.
2. Define Timestream Database and Tables:
   - Create the necessary Timestream databases and tables that will be used for fine-grained access control. Design your database schema and define the tables, columns, and rows that need granular access control.
3. Create IAM Policies for Fine-Grained Access:
   - Access the AWS Management Console and navigate to the IAM service. Define IAM policies that grant or deny permissions for specific Timestream actions, databases, tables, columns, or rows. Leverage Timestream's fine-grained access control policy language to specify the conditions and restrictions for access.
4. Assign IAM Policies to IAM Users, Groups, or Roles:
   - Associate the IAM policies created earlier with the respective IAM users, groups, or roles. Assign the appropriate policies to grant access to specific Timestream databases, tables, columns, or rows. Follow the principle of least privilege and provide only the necessary permissions to users based on their requirements.
5. Test Fine-Grained Access Control:
   - Validate the fine-grained access control settings by attempting different actions on Timestream databases, tables, columns, or rows. Verify that the defined policies accurately restrict or allow access based on the specified conditions. Perform thorough testing to enforce the expected granularity and security level.
6. Regularly Review and Update Access Policies:
   - Periodically review the fine-grained access control policies to ensure they align with your organization's security requirements. Remove any unnecessary or outdated policies. Regularly monitor IAM activity logs and AWS CloudTrail to identify any unauthorized access attempts or unusual activities related to fine-grained access control.

## Expected Result

Fine-grained IAM policies should be configured to control access to specific Timestream databases, tables, columns, and rows based on the principle of least privilege.

## Remediation

### Using AWS Console

Follow the audit steps above to implement fine-grained access control for your Amazon Timestream resources.

## Default Value

No fine-grained access control policies are configured by default. IAM policies must be manually created and assigned.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

Level 1 | Manual
