---
name: cis-aws-storage-3.1
description: "EFS - Ensure AWS EFS is implemented for file system deployment"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, efs, file-system, managed-storage]
cis_id: "3.1"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-3.2, cis-aws-storage-3.3]
prerequisites: []
severity_boost: {}
---

# 3.1 EFS (Manual)

## Profile Applicability
- Level 2

## Description
AWS EFS is a scalable and fully-managed storage service that enables you to quickly deploy file systems without the hassle of configuring, patching, or maintaining them.

## Rationale
Utilize AWS EFS to streamline your file system deployment, allowing the service to handle the heavy lifting for you.

## Impact
Not using AWS EFS for your file system deployment can lead to increased management overhead, as you'll need to manually configure, patch, and maintain the systems. This manual effort is time-consuming and complex, raising the potential for errors that could result in downtime and data loss. By not leveraging AWS EFS, you miss out on the streamlined, automated management and scalability that the service provides, potentially impacting your operational efficiency and reliability.

## Audit Procedure

### Console

To create an Amazon EFS (Elastic File System), you can follow these steps:

1. Sign in to the AWS Management Console and navigate to the Amazon EFS console - https://us-east-2.console.aws.amazon.com/efs?region=us-east-2#/get-started
2. Click on the "Create file system" button.
3. Enter a name for your file system.
4. Choose a VPC for your file system
5. Then you have to go to File system settings to edit configurations, then you have to select Lifecycle management, performance settings and File system protection, and then click save changes.

## Expected Result
AWS EFS file system should be created and configured with appropriate lifecycle management, performance settings, and file system protection enabled.

## Remediation

### Console

To create an Amazon EFS (Elastic File System), follow these steps:

1. **Open the Amazon EFS Console**: Sign in to your AWS Management Console and navigate to the Amazon EFS service.

2. **Create File System**: Click on the "Create file system" button to start the creation process.

3. **Configure File System**: Select your desired VPC (Virtual Private Cloud) and availability zones for the file system. Optionally, you can configure settings like throughput mode and lifecycle management.

4. **Configure Access Points**: Set up access points if needed, to control access permissions and streamline access management.

5. **Review and Create**: Review your settings and click on the "Create" button to create the file system.

6. **Mount the File System**: Once created, use the provided mount targets and instructions to mount the file system to your EC2 instances or other resources.

## Default Value
By default, AWS does not automatically create EFS file systems. File systems must be explicitly created and configured by the user.

## References
1. https://us-east-2.console.aws.amazon.com/efs?region=us-east-2#/get-started

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process<br/>Establish and maintain a secure configuration process for enterprise assets (end-user devices, including portable and mobile, non-computing/IoT devices, and servers) and software (operating systems and applications). Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard. | ● | ● | ● |
| v8 | 7.3 Perform Automated Operating System Patch Management<br/>Perform operating system updates on enterprise assets through automated patch management on a monthly, or more frequent, basis. | ● | ● | ● |
| v7 | 3.4 Deploy Automated Operating System Patch Management Tools<br/>Deploy automated software update tools in order to ensure that the operating systems are running the most recent security updates provided by the software vendor. | ● | ● | ● |
| v7 | 5.4 Deploy System Configuration Management Tools<br/>Deploy system configuration management tools that will automatically enforce and redeploy configuration settings to systems at regularly scheduled intervals. | | ● | ● |

## Profile
Level 2
