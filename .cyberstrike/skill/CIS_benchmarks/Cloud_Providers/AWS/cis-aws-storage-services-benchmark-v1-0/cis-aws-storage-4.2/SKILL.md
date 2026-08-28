---
name: cis-aws-storage-4.2
description: "Amazon Elastic File Cache"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, fsx, file-cache, regional-availability, level-2]
cis_id: "4.2"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-4.1, cis-aws-storage-4.3, cis-aws-storage-4.4, cis-aws-storage-4.5]
prerequisites: []
severity_boost: {}
---

# 4.2 Amazon Elastic File Cache (Manual)

## Profile Applicability

- Level 2

## Description

Amazon File Cache is available in the following AWS Regions:

1. US East (N. Virginia)
2. US East (Ohio)
3. US West (Oregon)
4. Canada (Central)
5. Europe (Frankfurt)
6. Europe (Ireland)
7. Europe (London)
8. Europe (Stockholm)
9. Asia Pacific (Hong Kong)
10. Asia Pacific (Mumbai)
11. Asia Pacific (Seoul)
12. Asia Pacific (Tokyo)
13. Asia Pacific (Singapore)
14. Asia Pacific (Sydney)

**Amazon Elastic File Cache Compatibility:** In order to use AWS FSx, you must ensure that the operating system you're using on the compute instance is compatible with AWS FSx. Below are the compatible operating systems:

1. Amazon Linux 2 and Amazon Linux
2. Red Hat Enterprise Linux (RHEL)
3. CentOS
4. Rocky Linux
5. Ubuntu. The Lustre client must be installed on these systems in order for the FSx service to work.

## Rationale

The rationale behind creating Amazon Elastic File Cache is to enhance the performance and scalability of cloud-based applications by providing a high-speed, scalable file caching solution. This service reduces latency and improves access times for frequently accessed data, thereby optimizing application performance and user experience. Additionally, it helps manage and reduce storage costs by efficiently utilizing cached data, ensuring that resources are used effectively while maintaining high performance standards.

## Impact

Not implementing Amazon Elastic File Cache can lead to increased latency and slower access times for frequently accessed data, resulting in suboptimal performance for cloud-based applications. This can negatively affect user experience and productivity. Additionally, without an efficient caching solution, there may be higher storage costs due to inefficient use of resources, and the system may struggle to handle high demand, leading to potential performance bottlenecks and scalability issues.

## Audit Procedure

### AWS Console

**Creating Amazon Elastic File Cache:**

Before you can start using Amazon Elastic File Cache, you must set up an Amazon Elastic Compute Instance and an S3 bucket.

1. Navigate to the Amazon EC2 console
2. Select "Launch Instance"
3. Give your server a name
4. Select "Ubuntu" or an operating system that's compatible with FSx
5. Select default VPC and security group
6. Select or create private SSH keys
7. Leave the rest of the settings default
8. Create Instance

**Verify regional availability:**

- Confirm that your resources are deployed in one of the supported regions listed above
- Verify that the EC2 instance OS is compatible with Lustre client (Amazon Linux 2, Amazon Linux, RHEL, CentOS, Rocky Linux, or Ubuntu)
- Ensure that the AMI selected is compatible with Lustre 2.12 client

### AWS CLI

No specific CLI audit commands are provided in this control as it is primarily about regional availability and compatibility verification.

## Expected Result

Amazon Elastic File Cache should be deployed in supported regions with compatible operating systems. The Lustre client must be installed on Ubuntu systems for FSx service to work properly.

## Remediation

### AWS Console

1. Verify that your AWS region is in the list of supported regions
2. If deploying in an unsupported region, migrate resources to a supported region
3. Ensure EC2 instances use compatible operating systems:
   - Amazon Linux 2 or Amazon Linux
   - Red Hat Enterprise Linux (RHEL)
   - CentOS
   - Rocky Linux
   - Ubuntu (with Lustre client installed)
4. For Ubuntu systems, proceed with Lustre client installation (see control 4.5)

### AWS CLI

No specific CLI remediation commands are required for this control.

## Default Value

Amazon Elastic File Cache is available only in the regions listed above. The service requires compatible operating systems to function properly.

## References

1. https://aws.amazon.com/fsx/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v8               | 8.3 Ensure Adequate Audit Log Storage<br/>Ensure that logging destinations maintain adequate storage to comply with the enterprise's audit log management process.                                                                                                                                                                                                                                       | ●    | ●    | ●    |
| v7               | 6.4 Ensure adequate storage for logs<br/>Ensure that all systems that store logs have adequate storage space for the logs generated.                                                                                                                                                                                                                                                                     |      | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |

## Profile

Level 2
