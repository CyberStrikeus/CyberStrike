---
name: cis-aws-database-8.1
description: "Ensure Keyspace Security is Configured"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, keyspaces, cassandra, security-configuration]
cis_id: "8.1"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-8.2, cis-aws-database-8.3, cis-aws-database-8.4]
prerequisites: []
severity_boost: {}
---

# 8.1 Ensure Keyspace Security is Configured (Manual)

## Description

To access Amazon Keyspaces, the user would be required to log in with their AWS credentials. Once logged in the user can access the AWS resources and can explore the resources that Amazon Keyspaces offers. Amazon Keyspaces offers a lot of security that can mitigate a potential attack.

## Rationale

Ensuring keyspace security is configured helps protect Amazon Keyspaces resources by leveraging built-in security features including encryption at rest, encryption in transit, VPC support, authentication via IAM, access control via ACLs, and audit logging.

## Impact

Proper security configuration ensures that Amazon Keyspaces resources are protected from unauthorized access and potential attacks.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.
2. Open the Amazon Keyspaces Console - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/keyspaces/.
3. Explore Amazon Keyspaces Security Features:
   - In the Amazon Keyspaces console, navigate to the `Features` or `Security` section to explore the available security features.
   - Take note of the following critical security features:
     - Encryption at Rest: Understand how Amazon Keyspaces provides encryption at rest for your data. It uses server-side encryption by default, ensuring that data stored in Keyspaces is encrypted.
     - Encryption in Transit: Learn how to configure encryption in transit for data transmitted between your client applications and Amazon Keyspaces. Amazon Keyspaces supports Transport Layer Security (TLS) encryption to secure the communication channel.
     - Virtual Private Cloud (VPC) Support: Explore the VPC support options Amazon Keyspaces provides. It allows you to deploy your Keyspaces resources within your VPC for enhanced network isolation and control.
     - Authentication Options: Understand the authentication mechanisms available in Amazon Keyspaces. IAM for Cassandra allows you to use AWS Identity and Access Management (IAM) to authenticate and authorize client connections to Keyspaces.
     - Access Control: Learn about access control options in Amazon Keyspaces. It supports fine-grained access control using Access Control Lists (ACLs) at the table and row level to manage access permissions for different users or roles.
     - Audit Logging: Explore how to enable audit logging for Amazon Keyspaces. Amazon CloudWatch Logs can capture and store logs from your Keyspaces resources, providing visibility into activities for security and compliance purposes.
4. Documentation and Resources:
   - Access the official Amazon Keyspaces documentation by navigating to the `Documentation` or `Learn` section in the Amazon Keyspaces console.
   - Review the comprehensive documentation to gain in-depth knowledge about each security feature, including best practices, configuration options, and implementation details.
   - Utilize other AWS resources such as whitepapers, blogs, and security-related documentation further to enhance your understanding of Amazon Keyspaces security features.

## Expected Result

All security features (encryption at rest, encryption in transit, VPC support, IAM authentication, ACLs, audit logging) should be properly configured for the Amazon Keyspaces environment.

## Remediation

### Using AWS Console

Follow the audit steps above to review and configure each security feature in the Amazon Keyspaces console. Ensure all security features are properly enabled and configured according to your organization's security requirements.

## Default Value

Amazon Keyspaces provides server-side encryption at rest by default. Other security features require manual configuration.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

Level 1 | Manual
