---
name: cis-aws-database-10.9
description: "Ensure to Review and Update the Security Configuration"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, timestream, time-series, security-review, compliance]
cis_id: "10.9"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-10.7, cis-aws-database-10.8, cis-aws-database-10.10]
prerequisites: []
severity_boost: {}
---

# 10.9 Ensure to Review and Update the Security Configuration (Manual)

## Description

Conduct regular security reviews and assessments of your Amazon Timestream implementation. Evaluate access permissions, encryption settings, and security controls to ensure they align with your organization's security requirements.

## Rationale

By regularly reviewing security configuration it helps the businesses to detect any threat they might be hindering and address the threat in a timely manner.

## Impact

This helps by reviewing the database factors from database engine, review instance details, security networks, encryption settings, audit logging, and authentication. By updating or removing a few things from these lists it helps tighten security and ensures that the users do not have excessive permissions.

## Audit Procedure

### Using AWS Console

1. Understand Security Best Practices:
   - Familiarize yourself with the security best practices and recommendations provided by AWS for Timestream. Stay updated with the latest security guidelines and recommendations from AWS.
2. Review IAM Policies:
   - Regularly review the IAM policies associated with Timestream resources. Ensure that the assigned IAM policies provide the necessary permissions for users and roles while adhering to the principle of least privilege.
3. Audit User Access:
   - Periodically review the list of users and roles that have access to Timestream. Remove any unnecessary or unused accounts or permissions to minimize the attack surface.
4. Monitor Access Patterns:
   - Utilize AWS CloudTrail and Amazon CloudWatch logs to monitor access patterns and activities related to Timestream. Set up alerts and notifications to detect any suspicious or unauthorized access attempts.
5. Implement Security Controls:
   - Continuously assess and evaluate the security controls in place for Timestream. Implement additional security measures, such as VPC peering, security groups, or network ACLs, to further secure access to Timestream resources.
6. Regularly Review Security Group Rules:
   - Regularly review the security group rules associated with Timestream instances. Remove any unnecessary open ports or protocols to minimize potential attack vectors.
7. Stay Informed about Security Updates:
   - Keep track of security updates, patches, and new features released by AWS for Timestream. Stay informed about any security vulnerabilities or fixes related to Timestream.
8. Conduct Security Assessments:
   - Perform periodic security assessments on your Timestream implementation, including vulnerability and penetration testing. Identify and remediate any security vulnerabilities or weaknesses discovered during the assessments.
9. Stay Compliant:
   - Regularly review and update your security configurations to meet compliance requirements and industry standards. Stay informed about any changes in compliance regulations that may impact your Timestream environment.
10. Educate and Train:
    - Provide regular security awareness training to users and administrators working with Timestream. Ensure that everyone involved understands their security responsibilities and follows security best practices.

## Expected Result

Regular security reviews should be conducted with documented findings and remediation actions. All security configurations should be current and aligned with organizational security policies.

## Remediation

### Using AWS Console

Establish a regular security review schedule and follow the audit steps above to review and update all security configurations for your Timestream environment.

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
