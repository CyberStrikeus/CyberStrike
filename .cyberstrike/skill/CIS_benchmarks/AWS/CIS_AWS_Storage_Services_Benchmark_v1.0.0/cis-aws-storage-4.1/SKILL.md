---
name: cis-aws-storage-4.1
description: "FSX (AWS Elastic File Cache)"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, fsx, file-cache, level-2]
cis_id: "4.1"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-4.2, cis-aws-storage-4.3, cis-aws-storage-4.4]
prerequisites: []
severity_boost: {}
---

# 4.1 FSX (AWS Elastic File Cache) (Manual)

## Profile Applicability
- Level 2

## Description

Amazon File Cache is a fully managed, high speed cache on AWS that is used to process file data, regardless of where such data is stored. AWS File Cache is a serverless service on AWS that spares the administrators from the burden of managing file servers and storage volumes, updating hardware, configuring software, running out of capacity, or tuning performance. AWS Elastic File Cache is capable of handling hundreds of GB/s of throughput and up to millions of operations per second. AWS FSx is an excellent service for cost optimization and high scalability. Amazon File Cache automatically loads data into the cache when it's accessed for the first time and automatically releases data when it's not used.

## Rationale

Amazon File Cache is used as a temporary, high performance storage location for data that's stored in on-premises file systems, AWS file systems, and Amazon S3 buckets. This service is used for data processing and is best suited for applications that need high data processing speeds. This is not a long term storage option.

## Impact

Not implementing Amazon Elastic File Cache as a high-performance caching layer can result in slower data processing times and increased latency when accessing data from primary storage systems. This may lead to reduced application performance and operational efficiency.

## Audit Procedure

### AWS Console

Amazon File Cache can be linked to various data repositories including:
- S3 data repositories
- On-premises file systems (NFSv3 protocol)
- AWS file systems
- Amazon Elastic Compute Service
- Amazon Elastic Container Service
- Amazon Elastic Kubernetes Service

**Steps:**
1. Navigate to the Amazon FSx console
2. Review existing File Cache configurations
3. Verify that File Cache is linked to appropriate data repositories
4. Confirm that all linked repositories are using the same file system (either S3 or NFS objects)

### AWS CLI

No specific CLI audit commands are provided in this control as it is primarily informational about the FSX service capabilities.

## Expected Result

File Cache should be properly configured and linked to authorized data repositories. The cache should transparently present S3 or NFS objects as files and directories.

## Remediation

### AWS Console

To implement Amazon File Cache:

1. Ensure you have the necessary prerequisites:
   - Amazon Elastic Compute Instance with compatible OS
   - S3 bucket for data storage
   - Proper VPC and security group configuration

2. Navigate to the Amazon FSx console
3. Configure File Cache to link to your data repositories
4. You can link a maximum of eight repositories
5. All linked repositories must be using the same file system (either S3 or NFS)
6. Amazon File Cache is compatible with:
   - Amazon Elastic Compute Service
   - Amazon Elastic Container Service
   - Amazon Elastic Kubernetes Service

### AWS CLI

No specific CLI remediation commands are provided as this is a configuration guidance control.

## Default Value

By default, Amazon File Cache is not enabled. It must be explicitly configured and linked to data repositories.

## References

1. https://aws.amazon.com/fsx/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ● | ● | ● |
| v8 | 8.3 Ensure Adequate Audit Log Storage<br/>Ensure that logging destinations maintain adequate storage to comply with the enterprise's audit log management process. | ● | ● | ● |
| v7 | 13.4 Only Allow Access to Authorized Cloud Storage or Email Providers<br/>Only allow access to authorized cloud storage or email providers. | | ● | ● |
| v7 | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ● | ● | ● |

## Profile
Level 2
