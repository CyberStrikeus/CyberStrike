---
name: cis-aws-storage-3.5
description: "Ensure using Security Groups for VPC to control EFS traffic"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, efs, security-groups, vpc, network-security, traffic-control]
cis_id: "3.5"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-3.4, cis-aws-storage-3.6, cis-aws-storage-3.8]
prerequisites: []
severity_boost: {}
---

# 3.5 Ensure using Security Groups for VPC (Manual)

## Profile Applicability

- Level 2

## Description

A security group controls the traffic that is allowed to reach and leave the resources that it is associated with. For example, after you associate a security group with an EC2 instance, it controls the inbound and outbound traffic for the instance.

## Rationale

Security groups act as virtual firewalls to control network traffic to EFS mount targets, ensuring only authorized traffic can access the file system.

## Impact

Without properly configured security groups, EFS mount targets may be exposed to unauthorized network access, potentially leading to data breaches or service disruptions.

## Audit Procedure

### Console

1. Go to https://console.aws.amazon.com/vpc/
2. Navigate to Security Groups and select on the VPC that houses your mount target.
3. Ensure that incoming traffic is restricted to SSH access on port 22 using TCP protocol and outbound traffic is accepting all traffic.

## Expected Result

- Security Groups should be configured to allow only necessary inbound traffic (e.g., SSH on port 22)
- Outbound traffic rules should be appropriately configured
- Security Groups should follow least privilege principle

## Remediation

### Console

Configure security groups to restrict traffic appropriately:

1. Navigate to VPC console
2. Select Security Groups
3. Configure inbound rules to allow only necessary traffic (e.g., SSH on port 22 using TCP)
4. Configure outbound rules as needed
5. Apply security groups to EFS mount targets

## Default Value

By default, the default security group for a VPC allows all inbound traffic from instances assigned to the same security group and all outbound traffic. Custom security groups must be explicitly configured for EFS mount targets.

## References

1. https://console.aws.amazon.com/vpc/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.7 Centralize Access Control<br/>Centralize access control for all enterprise assets through a directory service or SSO provider, where supported.                                                                                                                                                            |      | ●    | ●    |
| v8               | 13.9 Deploy Port-Level Access Control<br/>Deploy port-level access control. Port-level access control utilizes 802.1x, or similar network access control protocols, such as certificates, and may incorporate user and/or device authentication.                                                               |      |      | ●    |
| v7               | 1.7 Deploy Port Level Access Control<br/>Utilize port level access control, following 802.1x standards, to control which devices can authenticate to the network. The authentication system shall be tied into the hardware asset inventory data to ensure only authorized devices can connect to the network. |      | ●    | ●    |

## Profile

Level 2
