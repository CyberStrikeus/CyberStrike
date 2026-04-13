---
name: cis-aws-database-9.6
description: "Ensure Security Configurations are Reviewed Regularly"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, neptune, graph-database, security-review, compliance]
cis_id: "9.6"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-9.1, cis-aws-database-9.4, cis-aws-database-9.5]
prerequisites: []
severity_boost: {}
---

# 9.6 Ensure Security Configurations are Reviewed Regularly (Manual)

## Description

This helps by removing or updating any IAM roles, security networks, encryption settings, audit logging, and authentication. By updating or removing a few things from these lists it helps tighten security and ensures that the users do not have excessive permissions.

## Rationale

Regular security reviews ensure that configurations remain aligned with current security requirements and best practices, preventing configuration drift and excessive permissions.

## Impact

By updating and revising the control within our Amazon Neptune cluster it would keep the system as secure as possible.

## Audit Procedure

### Using AWS Console

1. Establish a Security Review Schedule:
   - Determine a regular schedule for reviewing and updating the security configuration of your Amazon Neptune environment.
   - Consider factors such as the frequency of changes, compliance requirements, and industry best practices to determine the appropriate review interval.
2. Monitor AWS Security Bulletins:
   - Stay informed about AWS security updates and announcements related to Amazon Neptune.
   - Regularly review AWS security bulletins and notifications to identify any security patches, updates, or new features relevant to your Neptune environment.
   - Take note of any security recommendations or best practices provided by AWS.
3. Review IAM Roles and Policies:
   - Access the AWS Identity and Access Management (IAM) console by navigating to `IAM` in the AWS Management Console.
   - Review the IAM roles and policies associated with your Neptune resources.
   - Ensure that the assigned permissions align with the principle of least privilege and reflect the current access requirements.
   - Update the IAM roles and policies as needed to adapt to changes in user access or security requirements.
4. Review Security Groups and Network ACLs:
   - Access the Amazon Neptune console by navigating to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/neptune/.
   - In the Neptune console, navigate to the `Connectivity & Security` or `Network & Security` section.
   - Review the security groups and network ACLs associated with your Neptune clusters.
   - Ensure that the inbound and outbound rules are up to date and aligned with your security requirements.
   - Remove any unnecessary or outdated rules and add new rules if required.
5. Review Encryption Settings:
   - Navigate to the `Configuration` section or relevant encryption settings in the Neptune console.
   - Review the encryption settings for both encryption at rest and encryption in transit.
   - Ensure that the appropriate encryption options and key management strategies are in place.
   - Consider rotating encryption keys periodically, following best practices and compliance requirements.
6. Review VPC Configuration:
   - Access the Amazon VPC console by navigating to `VPC` in the AWS Management Console.
   - Review the VPC configuration associated with your Neptune clusters.
   - Ensure the subnets, routing tables, and VPC peering settings are configured correctly.
   - Verify that the network architecture provides your Neptune resources' desired isolation and connectivity.
7. Conduct Security Assessments:
   - Periodically conduct security assessments and penetration testing on your Neptune environment.
   - Engage security experts or use appropriate security tools to identify vulnerabilities, weaknesses, or misconfigurations.
   - Analyze the assessment results and take necessary actions to remediate any security issues or risks.
8. Stay Up to Date with Best Practices:
   - Continuously educate yourself and your team on the latest security best practices for Amazon Neptune.
   - Stay informed about emerging security threats and vulnerabilities.
   - Regularly review AWS documentation, security blogs, and other relevant resources to enhance your understanding and implementation of security practices.

## Expected Result

All security configurations (IAM, security groups, network ACLs, encryption, VPC) should be reviewed and updated regularly according to an established schedule.

## Remediation

### Using AWS Console

Establish a regular security review schedule and follow the audit steps above to review and update all security configurations for your Neptune environment.

## Default Value

No automatic security review is configured. This is a manual process that must be established by the organization.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5 Account Management                                                                                  |      |      |      |
| v7               | 5 Secure Configuration for Hardware and Software on Mobile Devices, Laptops, Workstations and Servers |      |      |      |

## Profile

Level 1 | Manual
