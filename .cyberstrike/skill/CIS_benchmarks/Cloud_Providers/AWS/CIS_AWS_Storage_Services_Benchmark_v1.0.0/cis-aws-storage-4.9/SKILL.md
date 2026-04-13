---
name: cis-aws-storage-4.9
description: "Ensure cleaning up FSx Resources"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, fsx, cleanup, resource-management, cost-optimization, level-2]
cis_id: "4.9"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-4.1, cis-aws-storage-4.3, cis-aws-storage-4.4]
prerequisites: []
severity_boost: {}
---

# 4.9 Ensure cleaning up FSx Resources (Manual)

## Profile Applicability

- Level 2

## Description

Cleaning up FSx resources involves removing unused or unnecessary FSx file systems and associated components to optimize costs and maintain a secure cloud environment. This includes deleting redundant file systems, snapshots, and mount targets, while ensuring all data is backed up or migrated. Regular cleanup prevents resource sprawl, reduces expenses, and maintains the overall health and performance of your AWS infrastructure.

## Rationale

The rationale for cleaning up FSx resources is to optimize costs and ensure a secure and efficient cloud environment. By removing unused or unnecessary file systems, snapshots, and mount targets, you prevent resource sprawl and reduce unnecessary expenses. Regular cleanup also helps maintain the overall health and performance of your AWS infrastructure, ensuring it remains organized and secure.

## Impact

Failing to clean up FSx resources can lead to:

- **Cost Impact:** Continued billing for unused File Cache resources, EC2 instances, and S3 storage
- **Security Impact:** Orphaned resources may contain sensitive data and expand attack surface
- **Operational Impact:** Resource sprawl makes infrastructure management more difficult
- **Compliance Impact:** Unused resources may violate data retention policies

## Audit Procedure

### AWS Console

**Review FSx Resources:**

1. Navigate to the AWS Elastic File Cache console
2. Review all existing File Caches
3. Identify File Caches that are no longer needed
4. Verify that data has been backed up or migrated before deletion

**Review Associated Resources:**

1. **EC2 Instances:**
   - Navigate to Amazon EC2 console
   - Identify instances created for FSx testing/usage
   - Verify if instances are still needed

2. **S3 Buckets:**
   - Navigate to Amazon S3 console
   - Identify buckets associated with FSx File Cache
   - Verify if data should be retained or if bucket can be deleted
   - Check bucket size and storage costs

3. **Security Groups and Network Resources:**
   - Review security groups created for FSx
   - Identify unused VPC resources

### AWS CLI

```bash
# List all File Caches
aws fsx describe-file-caches \
  --query 'FileCaches[].{ID:FileCacheId,Name:FileCachePath,Status:Lifecycle,Size:StorageCapacity}' \
  --output table

# List EC2 instances
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=running,stopped" \
  --query 'Reservations[].Instances[].[InstanceId,InstanceType,State.Name,Tags[?Key==`Name`].Value|[0]]' \
  --output table

# List S3 buckets with size
aws s3 ls
aws s3 ls s3://<bucket-name> --recursive --summarize

# Get bucket size
aws s3api list-objects-v2 \
  --bucket <bucket-name> \
  --query 'sum(Contents[].Size)' \
  --output json
```

## Expected Result

All unused FSx resources should be identified and evaluated for cleanup:

- File Caches no longer in use should be deleted
- Associated EC2 instances should be terminated if not needed
- S3 buckets should be emptied and deleted if not required for data retention
- Orphaned security groups and network resources should be removed

## Remediation

### AWS Console

**To clean the FSx resources:**

1. **Terminate the EC2 instance:**
   - Navigate to EC2 console
   - Select the instance
   - Actions → Instance State → Terminate

2. **Delete FSx cache:**
   - Navigate to FSx console
   - On the actions drop down, select "delete cache"
   - Verify that you want to delete the service
   - Select `Delete`
   - **Note:** It will take some time to delete the cache

3. **Delete the S3 Bucket:**
   - Navigate to S3 console
   - **Before you can delete the bucket you must first empty the bucket**
   - Check the radio box and select `Empty`
   - Confirm by typing "permanently delete"
   - Select the bucket that you want to delete
   - Select `Delete` in the S3 console
   - Confirm deletion by typing the bucket name

### AWS CLI

```bash
# 1. Terminate EC2 instance
aws ec2 terminate-instances --instance-ids <instance-id>

# Verify termination
aws ec2 describe-instances --instance-ids <instance-id> \
  --query 'Reservations[].Instances[].State.Name'

# 2. Delete File Cache
aws fsx delete-file-cache --file-cache-id <cache-id>

# Monitor deletion status
aws fsx describe-file-caches --file-cache-ids <cache-id> \
  --query 'FileCaches[0].Lifecycle'

# 3. Empty S3 bucket
aws s3 rm s3://<bucket-name> --recursive

# Verify bucket is empty
aws s3 ls s3://<bucket-name>

# 4. Delete S3 bucket
aws s3api delete-bucket --bucket <bucket-name> --region <region>

# 5. Delete security groups (if created specifically for FSx)
# Note: Can only delete after all resources using them are terminated
aws ec2 delete-security-group --group-id <security-group-id>
```

### Cleanup Checklist

- [ ] Data backed up or migrated from File Cache
- [ ] EC2 instances terminated
- [ ] File Cache deleted
- [ ] S3 bucket emptied
- [ ] S3 bucket deleted (if not needed for retention)
- [ ] Security groups removed (if dedicated to FSx)
- [ ] VPC resources cleaned up (if created specifically for FSx)
- [ ] Verify no ongoing charges for deleted resources

## Default Value

FSx resources are not automatically cleaned up. Manual deletion is required for all components.

## References

1. https://docs.aws.amazon.com/fsx/latest/ONTAPGuide/getting-started-step3.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                      | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.8 Document Data Flows<br/>Document data flows. Data flow documentation includes service provider data flows and should be based on the enterprise's data management process. Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard.                                                      |      | ●    | ●    |
| v8               | 8.3 Ensure Adequate Audit Log Storage<br/>Ensure that logging destinations maintain adequate storage to comply with the enterprise's audit log management process.                                                                                                                                                                                           | ●    | ●    | ●    |
| v7               | 7.8 Implement DMARC and Enable Receiver-Side Verification<br/>To lower the chance of spoofed or modified emails from valid domains, implement Domain-based Message Authentication, Reporting and Conformance (DMARC) policy and verification, starting by implementing the Sender Policy Framework (SPF) and the DomainKeys Identified Mail(DKIM) standards. |      | ●    | ●    |
| v7               | 13.4 Only Allow Access to Authorized Cloud Storage or Email Providers<br/>Only allow access to authorized cloud storage or email providers.                                                                                                                                                                                                                  |      | ●    | ●    |

## Profile

Level 2
