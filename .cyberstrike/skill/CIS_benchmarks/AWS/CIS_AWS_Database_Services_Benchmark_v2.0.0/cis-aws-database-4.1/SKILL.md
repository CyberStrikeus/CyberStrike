---
name: cis-aws-database-4.1
description: "Ensure AWS Identity and Access Management (IAM) is in use"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, dynamodb, iam, access-control]
cis_id: "4.1"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-4.2]
prerequisites: []
severity_boost: {}
---

# 4.1 Ensure AWS Identity and Access Management (IAM) is in use

## Description
AWS Identity and Access Management (IAM) lets you securely control your users' access to AWS services and resources. To manage access control for Amazon DynamoDB, you can create IAM policies that control access to tables and data.

## Rationale
IAM policies help you control and maintain access to Amazon DynamoDB as needed.

## Impact
N/A

## Audit Procedure

### Using AWS Console
1. Open IAM Console
   - Sign in to the AWS Management Console and open the IAM console at https://console.aws.amazon.com/iam/.

2. Navigate to Policies
   - In the IAM console, in the navigation pane, choose `Policies`.

3. Create Policy
   - Choose `Create policy`.
   - You will be taken to the `Create policy` page.

4. Choose Service
   - Click on `Choose a service`.
   - Type `DynamoDB` in the search box and select it.

5. Configure Actions
   - Under the `Actions` section, select the actions you want to allow the user to perform.
   - For instance, you can select `Read` to allow read actions like GetItem, Scan, Query, etc.

6. Set Resources
   - Under the `Resources` section, you can specify which tables this policy applies to.
   - You can choose "All resources" or specify the ARN (Amazon Resource Name) of specific tables.

7. Review Policy
   - Click on `Review policy`.
   - Give your policy a name and description.
   - Then click `Create policy`.
   - Now, you have an IAM policy.

8. Attach Policy
   - Navigate to the `Users`, `Groups`, or `Roles` section in the IAM console.
   - Choose an existing user, group, or role, or create a new one.
   - Once you've selected a user, group, or role, click `Add permissions`.
   - Choose `Attach existing policies directly`.
   - Search for your created policy, select it, and click `Attach policy`.
   - With these steps, you have attached an IAM policy that controls access to DynamoDB resources.

## Expected Result
IAM policies are in place that control access to DynamoDB tables and data, following the principle of least privilege.

## Remediation

### Using AWS Console
Follow the same steps as the audit procedure to create and attach IAM policies for DynamoDB access control.

## Default Value
By default, no IAM policies are created for DynamoDB access. Users with AWS account root credentials have full access.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## Profile
Level 1 | Manual
