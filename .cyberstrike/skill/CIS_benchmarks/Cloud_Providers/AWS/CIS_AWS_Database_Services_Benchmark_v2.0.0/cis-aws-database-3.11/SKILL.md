---
name: cis-aws-database-3.11
description: "Ensure to Regularly Review Security Configuration"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, rds, security-review, configuration, hardening]
cis_id: "3.11"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with:
  [cis-aws-database-3.4, cis-aws-database-3.5, cis-aws-database-3.6, cis-aws-database-3.7, cis-aws-database-3.9]
prerequisites: []
severity_boost: {}
---

# 3.11 Ensure to Regularly Review Security Configuration (Manual)

## Description

This helps by reviewing the database factors from database engine, review instance details, security networks, encryption settings, audit logging, and authentication. By updating or removing a few things from these lists it helps tighten security and ensures that the users do not have excessive permissions.

## Rationale

Regular security configuration reviews ensure that security controls remain effective and aligned with organizational security policies and best practices.

## Impact

Updating the system and being updated with security configurations keeps everything secure and prevents it from an attack.

## Audit Procedure

### Using AWS Console

1. Sign into the AWS Management Console
   - Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon RDS Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/rds/.

3. Select the RDS Instance
   - Choose the Amazon RDS instance you want to review the security configuration.
   - Click on the instance name to access its details page.

4. Review the Database Engine Documentation
   - Refer to the documentation provided by the database engine vendor (e.g., MySQL, PostgreSQL, Oracle, SQL Server) to understand the security best practices and configuration options specific to the database engine you use on Amazon RDS.
   - Review the vendor's guidelines for securing the database engine and associated components.

5. Review the Instance Details
   - In the instance details page, review the configuration settings related to security.
   - Security group associations: Ensure the appropriate security groups are assigned to the RDS instance to control inbound and outbound traffic.
   - IAM database authentication: Verify if IAM database authentication is enabled for enhanced security.
   - Encryption at rest: Confirm if encryption at rest is enabled using either AWS-managed keys or customer-managed keys.
   - Encryption in transit: Check if SSL/TLS encryption is enabled for secure data transmission.
   - Backup and retention: Review the automated backup settings and retention period to ensure data recovery capability.

6. Review Database User Privileges
   - Click `Users` in the Amazon RDS console menu.
   - Review the privileges assigned to database users.
   - Ensure that the least privileged access is implemented, granting only necessary privileges to each user or role.

7. Review Audit and Logging Configuration
   - In the Amazon RDS console, navigate to the `Configuration` or `Monitoring & Logs` section.
   - Review the settings related to database audit logging and logging.
   - Ensure appropriate logs are enabled and configured to capture necessary information for security analysis and monitoring.

8. Review Network Security
   - In the Amazon RDS console, navigate to the `Connectivity & Security` or `Security` section.
   - Review the network security settings, including the associated security groups and their rules.
   - Verify that only necessary ports are open, and access is restricted to trusted sources.

9. Review and Address Security Recommendations
   - Periodically review the security recommendations provided by AWS through the Amazon RDS console or the AWS Trusted Advisor service.
   - Address any security recommendations promptly to ensure a secure configuration.

10. Document and Update
    - Document the security configuration settings and any changes made during the review process.
    - Maintain an up-to-date inventory of the security controls and configurations implemented for your RDS instances.

## Expected Result

All security configurations should be reviewed and documented. Security groups, encryption, authentication, logging, and backup settings should align with organizational security policies.

## Remediation

### Using AWS Console

Follow the audit steps above to review and address any security configuration gaps. Create a regular schedule for security configuration reviews (e.g., quarterly).

## Default Value

No automatic security configuration review is provided. This is a manual process that must be established by the organization.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5 Account Management                                                                                  |      |      |      |
| v7               | 5 Secure Configuration for Hardware and Software on Mobile Devices, Laptops, Workstations and Servers |      |      |      |

## Profile

Level 1 | Manual
