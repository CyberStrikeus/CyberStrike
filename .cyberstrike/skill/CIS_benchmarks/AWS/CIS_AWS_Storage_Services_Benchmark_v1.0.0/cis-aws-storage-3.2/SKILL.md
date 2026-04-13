---
name: cis-aws-storage-3.2
description: "Ensure Implementation of EFS for managed file system deployment"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, efs, file-system, automation, nfs]
cis_id: "3.2"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-3.1, cis-aws-storage-3.3, cis-aws-storage-3.7]
prerequisites: []
severity_boost: {}
---

# 3.2 Ensure Implementation of EFS (Manual)

## Profile Applicability
- Level 2

## Description
AWS EFS is a fully managed storage service that enables rapid file system deployment without the need for configuration, patching, or maintenance.

## Rationale
The rationale behind using AWS EFS is to simplify and expedite the deployment of file systems, eliminating the need for manual configuration, patching, and maintenance. This allows you to focus on other critical aspects of your operations while benefiting from a reliable, scalable, and fully managed storage solution.

## Impact
Not using AWS EFS can lead to increased complexity and time-consuming manual management for configuration, patching, and maintenance. This raises the risk of human error, system downtime, and data loss, while also making it more challenging to scale your file systems efficiently.

## Audit Procedure

### Console

1. Navigate to console - https://us-east-1.console.aws.amazon.com/efs/home?region=us-east-1#/get-started
2. Select "Create File System". Give the file system a name and select the default VPC. Select "Create".
3. Encrypting data at rest - The EFS is encrypted automatically upon creation.
4. Attach the EFS to an EC2 instance.
5. Navigate to file system details - Select the radio box next to the file system that was just created and select "view details".
6. Creating an NFS directory on your EC2 instance - Launch your EC2 instance. Once connected, Type following command:
   ```
   sudo mkdir efs
   ```
   to create a new efs directory.
7. Mounting an NFS directory on your EC2 instance - Navigate to find your EC2 DNS information. Paste this command into the console after making the efs directory:
   ```
   sudo mount -t nfs -o nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport mount-target-DNS:/ ~/efs-mount-point
   ```
   NOTE: The encryption takes place as soon as you mount the directory. This encrypts the data in transit.
8. Terminating the EC2 instance - The EFS file system that was just mounted doesn't persist on reboot. You can consult the AWS documentation to see how you can write a script to automatically mount the file system upon every reboot.

## Expected Result
- EFS file system should be created successfully
- Encryption at rest should be enabled by default
- NFS directory should be created and mounted on EC2 instance
- Data should be encrypted in transit when mounting

## Remediation

### Console

To remediate the issues of manual file system management, follow these steps to create and use Amazon EFS:

1. **Open the Amazon EFS Console**: Sign in to the AWS Management Console and navigate to the Amazon EFS service.

2. **Create a New File System**: Click on "Create file system" to start the setup process.

3. **Configure Settings**: Select your desired VPC, availability zones, throughput mode, and any additional settings like lifecycle management.

4. **Set Up Access Points**: Configure access points to control permissions and simplify access management.

5. **Review and Create**: Verify your settings and click "Create" to finalize the file system setup.

6. **Mount the File System**: Use the provided mount targets and instructions to attach the file system to your EC2 instances or other resources.

## Default Value
By default, AWS does not automatically create or configure EFS file systems. Users must explicitly create EFS file systems and configure encryption, which is enabled by default upon creation.

## References
1. https://aws.amazon.com/efs/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.11 Encrypt Sensitive Data at Rest<br/>Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data. Storage-layer encryption, also known as server-side encryption, meets the minimum requirement of this Safeguard. Additional encryption methods may include application-layer encryption, also known as client-side encryption, where access to the data storage device(s) does not permit access to the plain-text data. | | ● | ● |
| v8 | 8.3 Ensure Adequate Audit Log Storage<br/>Ensure that logging destinations maintain adequate storage to comply with the enterprise's audit log management process. | ● | ● | ● |
| v7 | 5.2 Maintain Secure Images<br/>Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates. | | ● | ● |
| v7 | 13.4 Only Allow Access to Authorized Cloud Storage or Email Providers<br/>Only allow access to authorized cloud storage or email providers. | | ● | ● |

## Profile
Level 2
