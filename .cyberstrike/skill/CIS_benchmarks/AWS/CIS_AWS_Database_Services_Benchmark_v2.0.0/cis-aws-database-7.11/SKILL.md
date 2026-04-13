---
name: cis-aws-database-7.11
description: "Ensure to Conduct Security Assessments"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, documentdb, security-assessment, penetration-testing, vulnerability]
cis_id: "7.11"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-7.1, cis-aws-database-7.2, cis-aws-database-7.3, cis-aws-database-7.4, cis-aws-database-7.5, cis-aws-database-7.6]
prerequisites: []
severity_boost: {}
---

# 7.11 Ensure to Conduct Security Assessments (Manual)

## Description

Periodically perform security assessments, including vulnerability assessments and penetration testing, to identify and address any security weaknesses. Review your security configuration against best practices and industry standards.

## Rationale

This helps ensure that any vulnerabilities that might lie dormant be addressed promptly, which would reduce the risk of a malicious attack. Reviewing and making sure the security policies are authentic ensures the safety of the organization data.

## Impact

Regular security assessments help identify and remediate security weaknesses before they can be exploited by attackers.

## Audit Procedure

### Using AWS Console

1. Define the Scope of the Security Assessment
   - Clearly define the scope of the security assessment for your Amazon DocumentDB cluster.
   - Determine the objectives, areas of focus, and any specific compliance or security standards you must adhere to.

2. Review Security Documentation
   - Familiarize yourself with the AWS security best practices and documentation related to Amazon DocumentDB.
   - Review the AWS Shared Responsibility Model and understand the security controls provided by AWS.

3. Assess Network Security
   - Review the network security configuration of your Amazon DocumentDB cluster.
   - Ensure it is deployed within a secure Virtual Private Cloud (VPC) with appropriate security groups and network access control lists (ACLs).
   - Validate that the network traffic to and from the cluster is appropriately restricted based on your security requirements.

4. Evaluate Encryption Configuration
   - Assess the encryption settings for your Amazon DocumentDB cluster.
   - Verify that encryption at rest is enabled and that the data stored in the cluster is encrypted.
   - Validate that encryption in transit is enforced, ensuring that all client connections to the cluster are encrypted using SSL/TLS.

5. Review Access Control Mechanisms
   - Evaluate the access control mechanisms implemented for your Amazon DocumentDB cluster.
   - Ensure that appropriate Identity and Access Management (IAM) policies and roles are in place to control access to the cluster.
   - Review user accounts and their privileges, and validate that multi-factor authentication (MFA) is enforced for administrative access.

6. Examine Audit Logging and Monitoring
   - Review the audit logging and monitoring configuration for your Amazon DocumentDB cluster.
   - Verify that audit logging is enabled, capturing relevant database activities and events.
   - Evaluate the monitoring setup using Amazon CloudWatch or other tools to detect unusual or suspicious activities.

7. Assess Backup and Disaster Recovery
   - Evaluate the backup and disaster recovery mechanisms in place for your Amazon DocumentDB cluster.
   - Verify that automated backups are enabled and configured with an appropriate retention period.
   - Validate that manual backups can be performed and restored successfully.

8. Perform Vulnerability Scanning and Penetration Testing (If Applicable)
   - If allowed and within the terms of service, perform vulnerability scanning and penetration testing on your Amazon DocumentDB cluster.
   - Conduct security assessments to identify any vulnerabilities or weaknesses that could be exploited.

9. Document Findings and Remediation Plan
   - Document the findings of your security assessment, including any identified vulnerabilities or areas of improvement.
   - Develop a remediation plan that addresses the identified issues and outlines the necessary actions to enhance the security posture of your DocumentDB cluster.

10. Implement Remediation Measures
    - Implement the necessary remediation measures based on your remediation plan.
    - Apply security patches, adjust configuration settings, and strengthen access controls as required.

11. Regularly Repeat the Security Assessment
    - Conduct regular security assessments on your Amazon DocumentDB cluster to ensure ongoing compliance and identify new risks or vulnerabilities.
    - Stay updated with security best practices and apply any relevant updates or patches to your cluster.

## Expected Result

Regular security assessments are conducted covering network security, encryption, access control, audit logging, and backup/disaster recovery configurations.

## Remediation

### Using AWS Console

Follow the audit procedure steps to conduct comprehensive security assessments. Implement remediation measures for any identified vulnerabilities and establish a schedule for regular assessments.

## Default Value

No automatic security assessment mechanism is provided. Organizations must establish their own assessment processes and schedules.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 18.1 Establish and Maintain a Penetration Testing Program | | X | X |
| v7 | 20.1 Establish a Penetration Testing Program | | X | X |

## Profile

Level 1 | Manual
