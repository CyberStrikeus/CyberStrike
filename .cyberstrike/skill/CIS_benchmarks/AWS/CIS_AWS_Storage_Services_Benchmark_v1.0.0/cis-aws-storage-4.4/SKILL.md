---
name: cis-aws-storage-4.4
description: "Ensure the creation of Elastic File Cache"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, fsx, file-cache, cache-creation, vpc, kms, level-2]
cis_id: "4.4"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-4.1, cis-aws-storage-4.2, cis-aws-storage-4.3, cis-aws-storage-4.5]
prerequisites: [cis-aws-storage-4.2, cis-aws-storage-4.3]
severity_boost: {}
---

# 4.4 Ensure the creation of Elastic File Cache (Manual)

## Profile Applicability
- Level 2

## Description

With the prerequisites completed, we can now proceed to create our Elastic File Cache.

## Rationale

By implementing an Elastic File Cache, frequently accessed data is stored closer to the application, reducing latency and speeding up access times. This approach optimizes resource utilization, improves user experience, and ensures that the system can handle high-demand workloads effectively.

## Impact

Without implementing Elastic File Cache, applications may experience higher latency, slower data access times, and reduced performance, particularly for frequently accessed data. This can negatively impact user experience and system efficiency.

## Audit Procedure

### AWS Console

1. Navigate to the AWS Elastic File Cache console: https://console.aws.amazon.com/fsx/
2. Click the hamburger menu on the left side of the screen and select "caches"
3. Review existing File Cache configurations
4. Verify the following for each cache:
   - Cache name is descriptive and follows naming conventions
   - Storage capacity is appropriately sized (should be in increments of 1.2 TiB)
   - Throughput capacity is calculated correctly based on storage (multiply cache storage capacity by throughput tier)
   - VPC configuration is correct and uses the appropriate VPC
   - Security groups are properly configured
   - Subnet selection is appropriate
   - Encryption is enabled using aws/fsx KMS encryption keys
   - Data repository associations (DRAs) are properly configured
   - Cache is linked to the correct S3 bucket path

### AWS CLI

```bash
# List all File Caches
aws fsx describe-file-caches --query 'FileCaches[].[FileCacheId,FileCachePath,Lifecycle,StorageCapacity]' --output table

# Describe a specific File Cache
aws fsx describe-file-caches --file-cache-ids <cache-id>

# Check Data Repository Associations
aws fsx describe-data-repository-associations --filters Name=file-cache-id,Values=<cache-id>
```

## Expected Result

Elastic File Cache should be properly created and configured with:
- Appropriate storage capacity (in 1.2 TiB increments)
- Correctly calculated throughput capacity
- Proper VPC and security group configuration
- KMS encryption enabled
- Valid Data Repository Association linking to S3 bucket

## Remediation

### AWS Console

1. Navigate to the AWS Elastic File Cache console: https://console.aws.amazon.com/fsx/
2. Click the hamburger menu on the left side of the screen and select "caches"
3. Select "Create Cache"
4. **Give your Cache a name.** Choose a name that you will remember
5. **Select the amount of storage capacity you need for your cache.** We'll select 1.2 TiB for this tutorial. You can select storage capacity in increments of 1.2 TiB
6. **Select the amount of throughput capacity.** The amount of Throughput capacity is calculated by multiplying the cache storage capacity by the throughput tier. For example:
   - For a 1.2 TiB cache, it's 1200 MB/s
   - For a 9.6 TiB cache, it's 9600 MB/s
   - Throughput capacity is the sustained speed at which the file server that hosts your cache can serve data
7. In the **Network & Security section**, provide networking and security group information:
   - For **Virtual Private Cloud (VPC)** choose the correct amazon VPC that you want to associate with your cache. We're going to use the default VPC
   - For **VPC Security Groups**, the ID for the default security group for your VPC should already be added
   - For **Subnet**, you can choose any of the available subnets
8. In the **Encryption section**, choose the Default aws/fsx KMS encryption keys to protect your data by encrypting your data at rest
9. You have the option to create tags; this is an optional step
10. Select "next"
11. In the **Data repository associations (DRAs) section**, there are no DRAs linking your cache to S3 or NFS repositories. We need to link the cache that we're creating to the Amazon S3 bucket that we created earlier:
    - For **Data repository type**, choose S3
    - For **Data repository path**, type the path of the S3 bucket that you want to associate with this cache. For example: `s3://(example-bucket)/(example-prefix)`
    - **Note:** To access this URL, go back to the S3 bucket that was just created and navigate to the directory of the folder that you created. Select "copy AWS URI"
    - For **cache path**, enter the name of a high-level directory such as `/ns1` or subdirectory such as `/ns1/subdir` within Amazon File Cache to associate with the S3 data repository. The first forward slash in the path is required
12. Select "Next" this will take you to the summary page
13. Choose "**Create Cache**." You will see your cache in the FSx dashboard

### AWS CLI

```bash
# Create File Cache
aws fsx create-file-cache \
  --file-cache-type LUSTRE \
  --file-cache-type-version 2.12 \
  --storage-capacity 1200 \
  --subnet-ids <subnet-id> \
  --security-group-ids <security-group-id> \
  --data-repository-associations '[
    {
      "FileCachePath": "/ns1",
      "DataRepositoryPath": "s3://<bucket-name>/<prefix>",
      "DataRepositorySubdirectories": []
    }
  ]' \
  --kms-key-id "alias/aws/fsx"

# Verify cache creation
aws fsx describe-file-caches --file-cache-ids <cache-id>
```

## Default Value

By default, no Elastic File Cache exists. It must be explicitly created and configured.

## References

1. https://aws.amazon.com/filecache/

## CIS Controls

This control does not map to specific CIS Controls but follows general AWS security best practices for encryption, network isolation, and access control.

## Profile
Level 2
