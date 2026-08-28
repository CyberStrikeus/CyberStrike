---
name: cis-aws-storage-2.6
description: "Ensure Proper IAM Configuration for EC2 Instances"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, ebs, ec2, iam, access-control, mfa, least-privilege]
cis_id: "2.6"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: [CWE-284, CWE-287]
chains_with: [cis-aws-storage-2.7, cis-aws-storage-2.8, cis-aws-storage-2.9]
prerequisites: []
severity_boost: {}
---

# CIS Control 2.6: Ensure Proper IAM Configuration for EC2 Instances (Manual)

## Profile Applicability

- **Level 2**

## Description

IAM, or Identity and Access Management, is a vital security service used to control and manage access to AWS resources, ensuring only authorized users and services can interact with them. It allows you to create users and groups, set permissions, enforce multi-factor authentication, and implement least privilege principles to enhance security and compliance.

## Rationale

The rationale behind using IAM is to enhance security by controlling and managing access to AWS resources, ensuring that only authorized users and services can interact with them. This minimizes the risk of unauthorized access and potential security breaches, while also allowing for the implementation of best practices such as multi-factor authentication and least privilege principles, which further strengthen the security and compliance of your AWS environment.

## Impact

Not implementing IAM properly can lead to significant security vulnerabilities, including unauthorized access to AWS resources, data breaches, and potential loss of sensitive information. Without IAM, it is challenging to enforce access controls, monitor user activity, and implement security best practices such as multi-factor authentication and least privilege principles. This can result in increased risk of malicious attacks, operational disruptions, non-compliance with regulatory requirements, and substantial financial damage.

## Audit Procedure

See detailed audit steps in the full control documentation including:

1. Access the AWS Management Console
2. Review IAM Users and Roles
3. Check IAM Policies
4. Analyze IAM Groups
5. Examine MFA Settings
6. Audit IAM Activity
7. Implement AWS Config Rules
8. Generate IAM Reports
9. Conduct Regular Reviews

## Remediation

1. Restrict Overly Permissive Policies
2. Enable Multi-Factor Authentication (MFA)
3. Rotate Access Keys
4. Remove Unnecessary Users and Roles
5. Implement Role-Based Access Control (RBAC)
6. Regularly Review and Update IAM Policies
7. Enable AWS CloudTrail and AWS Config
8. Conduct Security Awareness Training
9. Implement IAM Access Analyzer

## References

1. [AWS IAM Roles for EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/iam-roles-for-amazon-ec2.html)

## CIS Controls

| Controls Version | Control                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control       |      |      | ●    |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts |      | ●    | ●    |
