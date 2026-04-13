---
name: cis-aws-storage-2.8
description: "Ensure the Creation of IAM Groups"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, iam, iam-group, rbac, access-management]
cis_id: "2.8"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: [CWE-284]
chains_with: [cis-aws-storage-2.7, cis-aws-storage-2.9]
prerequisites: []
severity_boost: {}
---

# CIS Control 2.8: Ensure the Creation of IAM Groups (Manual)

## Profile Applicability

- **Level 2**

## Description

IAM Groups are collections of users that share the same permissions for accessing AWS resources. For instance, you can create a group named "Administrators," which includes users who require full access to your AWS environment. This simplifies permission management by assigning common access policies to all members of the group.

## Rationale

IAM groups in AWS simplify permission management by grouping users with similar access needs and applying common access policies, reducing administrative overhead and enhancing security through the principle of least privilege. This approach ensures consistency, scalability, and ease of auditing, strengthening the overall security posture of the AWS environment.

## Audit Procedure

### Via AWS Management Console

1. Enable AWS CloudTrail
2. Review CloudTrail Logs
3. Utilize AWS Config
4. Check IAM Console

### Via AWS CLI

\`\`\`bash
aws iam list-groups
aws iam get-group --group-name <GROUP_NAME>
aws iam list-attached-group-policies --group-name <GROUP_NAME>
\`\`\`

## Remediation

### Via AWS CLI

\`\`\`bash

# Create IAM group

aws iam create-group --group-name Administrators

# Attach policy to group

aws iam attach-group-policy \
 --group-name Administrators \
 --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

# Add user to group

aws iam add-user-to-group \
 --user-name <USERNAME> \
 --group-name Administrators
\`\`\`

## References

1. [Creating IAM Groups](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_groups_create.html)

## CIS Controls

| Controls Version | Control                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control    |      |      | ●    |
| v7               | 16.1 Maintain an Inventory of Authentication Systems |      | ●    | ●    |
| v7               | 16.2 Configure Centralized Point of Authentication   |      | ●    | ●    |
