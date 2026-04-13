---
name: cis-aws-database-6.5
description: "Ensure Security Configurations are Reviewed Regularly"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, memorydb, redis, security-review, iam, configuration]
cis_id: "6.5"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-6.1, cis-aws-database-6.2, cis-aws-database-6.3, cis-aws-database-6.4, cis-aws-database-6.6]
prerequisites: []
severity_boost: {}
---

# 6.5 Ensure Security Configurations are Reviewed Regularly (Manual)

## Description

This helps by removing or updating any IAM roles, security networks, encryption settings, audit logging, and authentication. By updating or removing a few things from these lists it helps tighten security and ensures that the users do not have excessive permissions.

## Rationale

Regular review of security configurations ensures that the MemoryDB cluster maintains a strong security posture and adapts to changing requirements.

## Impact

By regularly checking these settings in the database the user is preventing the database from a cyber threat.

## Audit Procedure

### Using AWS Console

1. Sign into the AWS Management Console
   - Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon MemoryDB Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/memorydb/.

3. Select the Cluster
   - Choose the Amazon MemoryDB cluster for which you want to update and review the security configuration.
   - Click on the cluster name to access its details page.

4. Review IAM Roles and Permissions
   - In the cluster details page, navigate to the `Security` or `Access Control` section.
   - Review the IAM roles and permissions associated with the cluster.
   - Ensure that the IAM roles have appropriate permissions and follow the principle of least privilege.
   - Review the IAM policies and make any necessary updates to align with your security requirements.

5. Review Network Security
   - In the cluster details page, navigate to the `Security` or `Network & Security` section.
   - Review the Virtual Private Cloud (VPC), subnets, security groups, and network ACLs associated with the cluster.
   - Ensure that the VPC and subnet configurations align with your security requirements.
   - Review the security group rules and network ACL rules to ensure they restrict access to necessary ports, IP ranges, and protocols.
   - Make any necessary updates to tighten the network security settings.

6. Review Encryption Settings
   - In the cluster details page, navigate to the `Security` or `Encryption` section.
   - Review the encryption settings for the cluster.
   - Ensure that encryption at rest and in transit are enabled and the appropriate encryption options are chosen.
   - Review any customer-managed keys used for encryption and verify their configurations.

7. Review Authentication and Access Control
   - In the cluster details page, navigate to the `Security` or `Access Control` section.
   - Review the authentication options and access control policies in place for the cluster.
   - Ensure that the authentication mechanisms and access control policies align with your security requirements.
   - Make any necessary updates to adapt to changing access requirements or security policies.

8. Review Audit Logging
   - In the cluster details page, navigate to the `Monitoring` or `Logging` section.
   - Review the logging configuration for the cluster.
   - Ensure that the logs are captured and stored as expected.
   - Please review the log retention settings and verify that they comply with your retention policies.

9. Regularly Monitor Security Bulletins
   - Stay updated with AWS security bulletins, advisories, and best practices.
   - Monitor AWS security announcements and subscribe to relevant security notifications.
   - Regularly review and apply security patches, updates, and recommended configuration changes for Amazon MemoryDB.

## Expected Result

All security configurations (IAM, network, encryption, authentication, logging) are reviewed and aligned with organizational security requirements.

## Remediation

### Using AWS Console

Follow the audit procedure steps to review and update all security configurations for each MemoryDB cluster on a regular schedule.

## Default Value

There is no automatic security review mechanism. Organizations must establish their own review cadence.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5 Account Management | | | |
| v7 | 5 Secure Configuration for Hardware and Software on Mobile Devices, Laptops, Workstations and Servers | | | |

## Profile

Level 1 | Manual
