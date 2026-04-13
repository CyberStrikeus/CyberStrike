---
name: cis-aws-storage-3.8
description: "Ensure managing mount target security groups"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, efs, mount-targets, security-groups, network-security]
cis_id: "3.8"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-3.5, cis-aws-storage-3.7]
prerequisites: []
severity_boost: {}
---

# 3.8 Ensure managing mount target security groups (Manual)

## Profile Applicability

- Level 2

## Description

Managing security groups for mount targets is essential for controlling access to your Amazon EFS file systems. By configuring these security groups, you ensure that only authorized network traffic can access your file systems, enhancing security. Regular reviews and updates of security group rules maintain strict access control, protecting your data from unauthorized access and potential breaches.

## Rationale

The rationale for managing security groups for mount targets is to ensure robust access control and security for your Amazon EFS file systems. By configuring these security groups, you restrict access to only authorized network traffic, thereby minimizing the risk of unauthorized access and potential data breaches. Regularly reviewing and updating these rules helps maintain strong security measures and compliance with organizational policies and industry standards.

## Impact

Not managing security groups for mount targets can lead to significant vulnerabilities, exposing your Amazon EFS file systems to unauthorized access and potential breaches. This lack of control increases the risk of malicious attacks, data theft, and data corruption. Consequently, your organization may face severe financial losses, operational disruptions, and damage to its reputation.

## Audit Procedure

### Console

1. Navigate to EFS.
2. Select file systems.
3. Click the radio box and select "view details".
4. Select the "manage" button.
5. Select "Networking" tab.
6. This will bring up a screen for each of your mount points.
7. To edit Security Groups, select "Manage". From here, you can edit security groups for each mount point. This gives you control of how traffic can flow between each subnet.

## Expected Result

- Security groups should be properly configured for each mount target
- Security groups should restrict traffic to authorized sources only
- Rules should follow least privilege principle
- Regular reviews of security group configurations should be documented

## Remediation

### Console

1. Navigate to EFS console
2. Select your file system
3. Click "Manage" button
4. Select "Networking" tab
5. For each mount target, click "Manage" to edit security groups
6. Configure security groups to allow only authorized traffic
7. Review and update rules regularly

## Default Value

By default, mount targets use the default security group of the VPC. Custom security groups should be configured to implement proper access controls.

## References

1. https://docs.aws.amazon.com/efs/latest/ug/accessing-fs.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v8               | 13.9 Deploy Port-Level Access Control<br/>Deploy port-level access control. Port-level access control utilizes 802.1x, or similar network access control protocols, such as certificates, and may incorporate user and/or device authentication.                                                                                                                                                         |      |      | ●    |
| v7               | 1.7 Deploy Port Level Access Control<br/>Utilize port level access control, following 802.1x standards, to control which devices can authenticate to the network. The authentication system shall be tied into the hardware asset inventory data to ensure only authorized devices can connect to the network.                                                                                           |      | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |

## Profile

Level 2
