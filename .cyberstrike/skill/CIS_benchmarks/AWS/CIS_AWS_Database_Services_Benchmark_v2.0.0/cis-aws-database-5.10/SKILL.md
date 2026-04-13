---
name: cis-aws-database-5.10
description: "Ensure Security Configurations are Reviewed Regularly"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, elasticache, redis, security-review, keyspaces, compliance]
cis_id: "5.10"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-5.7, cis-aws-database-5.8]
prerequisites: []
severity_boost: {}
---

# 5.10 Ensure Security Configurations are Reviewed Regularly

## Description

Regularly updating and reviewing the security configuration of your Amazon Keyspaces environment helps ensure that your database is protected against potential vulnerabilities and aligned with your security requirements.

## Rationale

N/A

## Impact

If you are not updating these regularly, your database would most likely become susceptible to a vulnerable attack. Not updating your IAM permission, network, and encryption setting, and controlling audit logging, would lead to the attacker getting into the system which would result in data loss.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console
   - Sign in to the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon Keyspaces Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/keyspaces/.

3. Select the Keyspace
   - Choose the Keyspace (database) for which you want to update and review the security configuration.
   - Click on the Keyspace name to access its details page.

4. Review IAM Roles and Permissions
   - In the Keyspace details page, click on the `Configuration` tab.
   - Under the `Authentication and access control` section, review the IAM roles and permissions associated with the Keyspace.
   - Ensure that the IAM roles have appropriate permissions and follow the principle of least privilege.
   - Review the IAM policies and make any necessary updates to align with your security requirements.

5. Review Network Security
   - In the Keyspace details page, click on the `Configuration` tab.
   - Under the `Network & Security` section, review the VPC, subnets, security groups, and network ACLs associated with the Keyspace.
   - Ensure that the VPC and subnet configurations align with your security requirements.
   - Review the security group rules and network ACL rules to ensure they restrict access to necessary ports, IP ranges, and protocols.
   - Make any necessary updates to tighten the network security settings.

6. Review Encryption Settings
   - In the Keyspace details page, click on the `Configuration` tab.
   - Under the `Encryption` section, review the encryption settings for the Keyspace.
   - Ensure that encryption at rest and in transit are enabled and the appropriate encryption options are chosen.
   - Review any customer-managed keys used for encryption and verify their configurations.

7. Review Access Control
   - In the Keyspace details page, click on the `Configuration` tab.
   - Under the `Authentication and access control` section, review the Access Control Lists (ACLs) for the Keyspace.
   - Ensure the ACLs define appropriate access permissions at the table and row levels.
   - Review the ACL rules and make any necessary updates to align with your security policies and access requirements.

8. Review Audit Logging
   - In the Keyspace details page, click on the `Configuration` tab.
   - Review the Keyspace's logging configuration under the `Logging` section.
   - Ensure the logs are captured and stored in CloudWatch Logs as expected.
   - Please review the log retention settings and y that they comply with your retention policies.

9. Regularly Monitor Security Bulletins
   - Stay updated with AWS security bulletins, advisories, and best practices.
   - Monitor AWS security announcements and subscribe to relevant security notifications.
   - Regularly review and apply security patches, updates, and recommended configuration changes for Amazon Keyspaces.

## Expected Result

All security configurations for Keyspaces (IAM, network, encryption, access control, audit logging) are regularly reviewed and updated to align with security requirements.

## Remediation

### Using AWS Console

Follow the same steps as the audit procedure to review and update security configurations for Amazon Keyspaces on a regular schedule.

## Default Value

N/A - This is a procedural control that requires regular manual review.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5 Account Management                                                                                  |      |      |      |
| v7               | 5 Secure Configuration for Hardware and Software on Mobile Devices, Laptops, Workstations and Servers |      |      |      |

## Profile

Level 1 | Manual
