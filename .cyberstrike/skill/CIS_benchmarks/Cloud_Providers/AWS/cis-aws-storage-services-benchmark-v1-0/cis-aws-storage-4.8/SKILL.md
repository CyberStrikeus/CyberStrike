---
name: cis-aws-storage-4.8
description: "Ensure exporting cache to S3"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, fsx, s3, data-export, backup, level-2]
cis_id: "4.8"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws, linux]
cwe_ids: []
chains_with: [cis-aws-storage-4.3, cis-aws-storage-4.7, cis-aws-storage-5.1]
prerequisites: [cis-aws-storage-4.3, cis-aws-storage-4.7]
severity_boost: {}
---

# 4.8 Ensure exporting cache to S3 (Manual)

## Profile Applicability

- Level 2

## Description

The S3 bucket we created earlier will store the files generated at this mount point.

## Rationale

The rationale behind using the S3 bucket to store files generated at the mount point is to ensure scalable, durable, and cost-effective storage for your data. By exporting files to S3, you benefit from its high availability and robust data management features, which enhances data security and accessibility. This approach also optimizes storage resource utilization and simplifies data backup and retrieval processes.

## Impact

Without exporting cache data to S3, files created in the cache mount point will not be persisted to durable storage. This can result in data loss when the cache is deleted or during cache failures, as FSx File Cache is designed as a temporary high-performance layer, not long-term storage.

## Audit Procedure

### SSH to EC2 Instance

1. Connect to your EC2 instance:

```bash
ssh -i "{KEY.pem}" ubuntu@{your-ec2-instance}
```

2. **Verify mount point has files:**

```bash
ls -la /mnt
```

3. **Check S3 bucket for exported data:**

```bash
# Use AWS CLI to list objects in the S3 bucket
aws s3 ls s3://<bucket-name>/<prefix>/ --recursive

# Check for specific test files
aws s3 ls s3://<bucket-name>/<prefix>/efx.txt
```

### AWS Console

1. Navigate to the Amazon S3 console
2. Select the bucket associated with your FSx cache
3. Navigate to the prefix/folder path configured in the Data Repository Association
4. Verify that files created in the cache mount point are present in S3

## Expected Result

Files created in the FSx cache mount point should be automatically exported to the S3 bucket through the Data Repository Association. The S3 bucket should contain the files with proper metadata and timestamps.

## Remediation

### SSH to EC2 Instance

We can export the files that were created to the S3 bucket using the following steps:

1. **Create a file on the FSx mount point:**

```bash
sudo touch efx.txt
```

2. **Run the command to export the file to S3:**

```bash
sudo lsm_hsm_archive efx.txt
```

3. **Verify the file was created in the mount point:**

```bash
ls -la /mnt
```

4. **Now check your S3 bucket that was created earlier:**
   - The file should now appear in the S3 bucket under the configured prefix/path

### AWS CLI

```bash
# Verify file creation in mount point (run on EC2 instance)
ls -la /mnt/efx.txt

# Check S3 bucket for the exported file (can run from anywhere with AWS credentials)
aws s3 ls s3://<bucket-name>/<prefix>/efx.txt

# Verify file content matches
aws s3 cp s3://<bucket-name>/<prefix>/efx.txt -

# List all files in the S3 bucket prefix
aws s3 ls s3://<bucket-name>/<prefix>/ --recursive --human-readable
```

### Automated Export Configuration

Ensure Data Repository Association is properly configured for automatic export:

```bash
# Verify DRA configuration
aws fsx describe-data-repository-associations \
  --filters Name=file-cache-id,Values=<cache-id> \
  --query 'Associations[0].[FileCachePath,DataRepositoryPath,DataRepositorySubdirectories]'
```

## Default Value

By default, FSx File Cache does not automatically export files to S3 without proper Data Repository Association configuration. The `lsm_hsm_archive` command or automatic export policies must be used to persist data to S3.

## References

1. https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/backups-exporting.html

## CIS Controls

This control supports data backup and recovery best practices but does not map to specific CIS Controls.

## Profile

Level 2
