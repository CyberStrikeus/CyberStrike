---
name: cis-aws-storage-3.3
description: "Ensure EFS and VPC Integration for redundancy and scalability"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, efs, vpc, ec2, redundancy, scalability, availability]
cis_id: "3.3"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-3.1, cis-aws-storage-3.2, cis-aws-storage-3.7]
prerequisites: []
severity_boost: {}
---

# 3.3 Ensure EFS and VPC Integration (Manual)

## Profile Applicability

- Level 2

## Description

You can use EFS as a network file system across availability zones on a virtual private cloud. This capability allows the organization to create a highly available file sharing solution. Leveraging AWS VPC and EC2 in tandem with AWS EFS makes for a highly available and scalable cloud file storage solution.

## Rationale

Redundancy and scalability are crucial for maintaining uninterrupted services. By integrating these AWS services, users can harness the full power of AWS, ensuring a resilient and scalable infrastructure.

## Impact

Not integrating AWS services for redundancy and scalability can lead to service disruptions and increased downtime. This approach also limits your ability to efficiently handle growing workloads, negatively impacting performance and user experience.

## Audit Procedure

### Audit Procedures for AWS Redundancy and Scalability

1. **Create Mount Targets in Each Availability Zone**: Ensure EFS is attached in each availability zone by creating mount targets in each subnet. Although multiple subnets can exist per availability zone, verify that EFS is configured to work with one subnet per zone to maintain redundancy.

2. **Monitor EFS with CloudWatch**: Use AWS CloudWatch to automatically monitor your EFS service. Check that alarms are configured and logs and events are tracked effectively, providing real-time insights into the performance and health of your file systems.

## Expected Result

- Mount targets should exist in each availability zone
- EFS should be configured for high availability across multiple subnets
- CloudWatch monitoring should be enabled with appropriate alarms configured

## Remediation

### Console

Create an EC2 instance in each availability zone within your VPC.

## Default Value

By default, AWS does not automatically create mount targets in all availability zones. Users must explicitly configure EFS mount targets for each desired availability zone to ensure redundancy.

## References

1. https://docs.aws.amazon.com/efs/latest/ug/how-it-works.html#how-it-works-conceptual

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest<br/>Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data. Storage-layer encryption, also known as server-side encryption, meets the minimum requirement of this Safeguard. Additional encryption methods may include application-layer encryption, also known as client-side encryption, where access to the data storage device(s) does not permit access to the plain-text data. |      | ●    | ●    |
| v8               | 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure<br/>Use standard, industry-recommended hardening configuration templates for application infrastructure components. This includes underlying servers, databases, and web servers, and applies to cloud containers, Platform as a Service (PaaS) components, and SaaS components. Do not allow in-house developed software to weaken configuration hardening.                    |      | ●    | ●    |
| v7               | 13.4 Only Allow Access to Authorized Cloud Storage or Email Providers<br/>Only allow access to authorized cloud storage or email providers.                                                                                                                                                                                                                                                                                                                        |      | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.                                                           | ●    | ●    | ●    |

## Profile

Level 2
