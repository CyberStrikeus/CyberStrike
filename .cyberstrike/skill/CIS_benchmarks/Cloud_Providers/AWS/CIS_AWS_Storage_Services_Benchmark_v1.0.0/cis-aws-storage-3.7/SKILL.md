---
name: cis-aws-storage-3.7
description: "Ensure File-Level Access Control with Mount Targets"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, efs, mount-targets, access-control, availability-zones]
cis_id: "3.7"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-3.3, cis-aws-storage-3.8]
prerequisites: []
severity_boost: {}
---

# 3.7 Ensure File-Level Access Control with Mount Targets (Manual)

## Profile Applicability

- Level 2

## Description

Mount targets act as gateways, enabling resources to be accessed across different availability zones within a VPC. When you create an EFS file system, mount targets are automatically provisioned in each availability zone associated with the VPC. This ensures high availability and redundancy, allowing seamless and efficient access to the EFS file system from any availability zone.

## Rationale

Using mount targets ensures seamless access to the EFS file system across different availability zones within a VPC. This automatic provisioning of mount targets in each availability zone provides high availability and redundancy, essential for maintaining uninterrupted data access. It simplifies configuration and enhances the resilience and scalability of the file system architecture.

## Impact

Not using mount targets can lead to inefficient and unreliable access to the EFS file system across availability zones. This lack of automatic provisioning reduces high availability and redundancy, increasing the risk of service interruptions and data access issues. Consequently, your infrastructure may suffer from decreased performance, higher latency, and potential data loss or downtime.

## Audit Procedure

### Console

Verify that mount targets are properly configured in each availability zone:

1. Navigate to EFS console
2. Select the file system
3. Verify mount targets exist in each availability zone
4. Ensure mount targets are associated with appropriate subnets

## Expected Result

- Mount targets should exist in each availability zone where the EFS is used
- Each mount target should be in a different availability zone for redundancy
- Mount targets should be properly associated with VPC subnets

## Remediation

### Console

Control access by modifying mount targets in each availability zone.

1. Navigate to EFS console
2. Select your file system
3. Configure mount targets for each availability zone
4. Ensure proper subnet association for high availability

## Default Value

Mount targets are not created by default. Users must explicitly create mount targets when setting up an EFS file system.

## References

1. https://docs.aws.amazon.com/efs/latest/ug/accessing-fs.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                                              | ●    | ●    | ●    |
| v8               | 6.8 Define and Maintain Role-Based Access Control<br/>Define and maintain role-based access control, through determining and documenting the access rights necessary for each role within the enterprise to successfully carry out its assigned duties. Perform access control reviews of enterprise assets to validate that all privileges are authorized, on a recurring schedule at a minimum annually, or more frequently. |      |      | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.                       | ●    | ●    | ●    |
| v7               | 14.7 Enforce Access Control to Data through Automated Tools<br/>Use an automated tool, such as host-based Data Loss Prevention, to enforce access controls to data even when data is copied off a system.                                                                                                                                                                                                                      |      |      | ●    |

## Profile

Level 2
