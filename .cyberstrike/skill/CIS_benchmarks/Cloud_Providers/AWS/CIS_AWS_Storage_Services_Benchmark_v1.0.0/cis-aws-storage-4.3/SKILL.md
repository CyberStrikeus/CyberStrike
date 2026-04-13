---
name: cis-aws-storage-4.3
description: "Ensure the creation of an FSX Bucket"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, fsx, s3, bucket-creation, level-2]
cis_id: "4.3"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-4.1, cis-aws-storage-4.2, cis-aws-storage-4.4, cis-aws-storage-5.1]
prerequisites: []
severity_boost: {}
---

# 4.3 Ensure the creation of an FSX Bucket (Manual)

## Profile Applicability

- Level 2

## Description

An S3 bucket will store the data that Amazon Elastic File Cache accesses.

## Rationale

Storing data in S3 ensures scalability, durability, and cost-efficiency, while Amazon Elastic File Cache enhances access speed by caching frequently accessed data. This combination leverages the strengths of both services, providing a seamless and efficient data storage and retrieval solution.

## Impact

Without creating an S3 bucket for FSx File Cache, there is no persistent storage backend for the cached data. This can lead to data loss, inability to persist data beyond the cache lifecycle, and reduced functionality of the File Cache service.

## Audit Procedure

### AWS Console

1. Navigate to the Amazon S3 bucket console: https://s3.console.aws.amazon.com/s3/
2. Review existing buckets
3. Verify that a dedicated bucket exists for FSx File Cache usage
4. Confirm the bucket configuration:
   - Bucket must have a unique name globally across AWS
   - Block public access should be enabled (this is an internal service not accessed outside the AWS network)
   - Bucket versioning should be enabled
   - Default encryption should be configured

### AWS CLI

```bash
# List all S3 buckets
aws s3api list-buckets --query 'Buckets[].[Name,CreationDate]' --output table

# Check bucket configuration for a specific bucket
aws s3api get-bucket-versioning --bucket <bucket-name>
aws s3api get-bucket-encryption --bucket <bucket-name>
aws s3api get-public-access-block --bucket <bucket-name>
```

## Expected Result

An S3 bucket should exist with the following configuration:

- Unique bucket name that is not used anywhere on AWS
- Block public access enabled
- Bucket versioning enabled
- Encryption enabled (default or custom KMS key)
- Appropriate path created within the bucket for FSx cache data

## Remediation

### AWS Console

1. Navigate to the Amazon S3 bucket console: https://s3.console.aws.amazon.com/s3/
2. Select "Create Bucket"
3. Give your bucket a name and select the region
   - **Note:** Your bucket must be a unique name that's not used anywhere on AWS
4. **Block public access:** This is an internal service that will not be accessed outside of our internal AWS network. Keep the "block public access" setting checked
5. Enable bucket versioning
6. Leave the rest of the settings as default
7. Select "create bucket"
8. Create a path in your bucket:
   - Give it a name and leave the encryption as default for now

### AWS CLI

```bash
# Create S3 bucket
aws s3api create-bucket \
  --bucket <unique-bucket-name> \
  --region <region> \
  --create-bucket-configuration LocationConstraint=<region>

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket <bucket-name> \
  --versioning-configuration Status=Enabled

# Enable server-side encryption
aws s3api put-bucket-encryption \
  --bucket <bucket-name> \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }'

# Block public access
aws s3api put-public-access-block \
  --bucket <bucket-name> \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Create a folder (prefix) in the bucket
aws s3api put-object \
  --bucket <bucket-name> \
  --key <folder-name>/
```

## Default Value

By default, no S3 buckets exist for FSx File Cache. They must be explicitly created and configured.

## References

1. https://docs.aws.amazon.com/fsx/latest/LustreGuide/create-dra-linked-data-repo.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v8               | 8.3 Ensure Adequate Audit Log Storage<br/>Ensure that logging destinations maintain adequate storage to comply with the enterprise's audit log management process.                                                                                                                                                                                                                                       | ●    | ●    | ●    |
| v7               | 6.4 Ensure adequate storage for logs<br/>Ensure that all systems that store logs have adequate storage space for the logs generated.                                                                                                                                                                                                                                                                     |      | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |

## Profile

Level 2
