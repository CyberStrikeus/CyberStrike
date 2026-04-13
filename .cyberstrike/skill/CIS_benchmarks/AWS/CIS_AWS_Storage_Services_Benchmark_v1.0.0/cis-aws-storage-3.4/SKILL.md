---
name: cis-aws-storage-3.4
description: "Ensure controlling Network access to EFS Services"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, efs, network-security, security-groups, nacl, iam]
cis_id: "3.4"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-3.5, cis-aws-storage-3.6, cis-aws-storage-3.8]
prerequisites: []
severity_boost: {}
---

# 3.4 Ensure controlling Network access to EFS Services (Manual)

## Profile Applicability
- Level 2

## Description
It's important that you secure access to your resources on your AWS VPC network. There are several ways to ensure that control what traffic is accessing your resources. Some of which include tightening down network layer security using a Security Group and a NACL within the VPC console. You can also tighten down Security Groups within your EC2 console and by using AWS IAM. Maintaining network security is a high priority to ensure that no unauthorized users can access the data stored on your EFS service.

## Rationale
Maintaining network security is a best practice essential for keeping your data safe and secure.

## Impact
Failing to maintain network security can lead to significant vulnerabilities, exposing your data to unauthorized access, breaches, and potential data loss. This can result in severe financial, operational, and reputational damage to your organization.

## Audit Procedure

### Console

Verify that appropriate network access controls are implemented for EFS services:

1. Review Security Groups and Network ACLs
2. Verify IAM policies restrict EFS access appropriately
3. Ensure only authorized traffic can reach EFS mount targets

## Expected Result
- Security Groups should restrict inbound traffic to necessary ports only
- Network ACLs should be configured to control traffic to/from subnets
- IAM policies should enforce least privilege access to EFS
- No unauthorized network paths to EFS resources

## Remediation

### Console

Implement network security access controls.

## Default Value
By default, AWS EFS mount targets inherit the security group of the VPC. Additional network access controls must be explicitly configured by the user.

## References
1. https://docs.aws.amazon.com/efs/latest/ug/NFS-access-control-efs.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ● | ● | ● |

## Profile
Level 2
