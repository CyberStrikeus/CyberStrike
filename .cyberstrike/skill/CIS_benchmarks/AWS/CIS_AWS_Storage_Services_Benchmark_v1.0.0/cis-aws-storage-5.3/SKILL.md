---
name: cis-aws-storage-5.3
description: "Ensure Storage Classes are Configured"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, s3, storage-classes, cost-optimization, lifecycle, intelligent-tiering, glacier, level-2]
cis_id: "5.3"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-5.1, cis-aws-storage-5.2]
prerequisites: [cis-aws-storage-5.1]
severity_boost: {}
---

# 5.3 Ensure Storage Classes are Configured (Manual)

## Profile Applicability
- Level 2

## Description

Amazon S3 offers various storage classes to optimize cost and performance based on data access patterns and retention needs. **Standard Storage** is for frequently accessed data, while **Standard-IA and One Zone-IA** are for infrequent access, with the latter offering cost savings by storing in a single Availability Zone. **Intelligent-Tiering** automatically moves data between access tiers based on usage, and **Glacier and Glacier Deep Archive** provide low-cost options for long-term archival storage with varying retrieval times. Each class balances availability, durability, performance, and cost, enabling a tailored storage strategy to meet specific requirements.

## Rationale

This approach ensures frequently accessed data is readily available, while infrequently accessed data is stored cost-effectively, balancing availability, durability, and cost.

## Impact

Not configuring appropriate storage classes can result in:
- **Cost Inefficiency:** Paying for Standard storage pricing for infrequently accessed data
- **Wasted Resources:** Not leveraging cost-optimized storage tiers
- **Missed Savings:** Failing to use Intelligent-Tiering for data with unknown or changing access patterns
- **Suboptimal Performance:** Using archive storage classes for frequently accessed data
- **Compliance Issues:** Not meeting data retention requirements with appropriate archival storage

## Audit Procedure

### AWS Console

1. Navigate to the Amazon S3 console
2. Select a bucket
3. Review objects and their storage classes:
   - Click on individual objects
   - Check the "Properties" tab
   - Verify the storage class assignment
4. Review lifecycle policies:
   - Navigate to "Management" tab
   - Check "Lifecycle rules"
   - Verify automatic transitions between storage classes
5. Check for Intelligent-Tiering configuration:
   - Review objects using S3 Intelligent-Tiering
   - Verify automatic tier optimization is enabled

### AWS CLI

```bash
# List objects with their storage classes
aws s3api list-objects-v2 \
  --bucket <bucket-name> \
  --query 'Contents[].[Key,StorageClass,Size,LastModified]' \
  --output table

# Get specific object storage class
aws s3api head-object \
  --bucket <bucket-name> \
  --key <object-key> \
  --query 'StorageClass'

# List lifecycle rules
aws s3api get-bucket-lifecycle-configuration \
  --bucket <bucket-name>

# Get Intelligent-Tiering configuration
aws s3api list-bucket-intelligent-tiering-configurations \
  --bucket <bucket-name>

# Analyze storage class distribution
aws s3api list-objects-v2 \
  --bucket <bucket-name> \
  --query 'Contents[].StorageClass' | sort | uniq -c
```

## Expected Result

S3 storage classes should be properly configured based on data access patterns:
- **Frequently accessed data:** S3 Standard
- **Infrequently accessed data (>30 days):** S3 Standard-IA or S3 One Zone-IA
- **Unknown/changing access patterns:** S3 Intelligent-Tiering
- **Archive data (rarely accessed):** S3 Glacier Flexible Retrieval or S3 Glacier Deep Archive
- Lifecycle policies configured to automatically transition objects between classes
- Cost optimization achieved through appropriate class selection

## Remediation

### Understanding S3 Storage Classes

**Available Storage Classes:**

1. **S3 Standard:**
   - For frequently accessed data
   - High durability (99.999999999%)
   - Low latency, high throughput
   - Most expensive

2. **S3 Standard-IA (Infrequent Access):**
   - For data accessed less frequently but requires rapid access when needed
   - Lower storage cost than Standard
   - Retrieval fees apply
   - Minimum storage duration: 30 days

3. **S3 One Zone-IA:**
   - Similar to Standard-IA but stored in a single Availability Zone
   - 20% lower cost than Standard-IA
   - Lower durability (99.5% availability)
   - Suitable for recreatable data

4. **S3 Intelligent-Tiering:**
   - Automatically moves data between access tiers based on usage
   - No retrieval fees
   - Small monthly monitoring and automation fee
   - Ideal for unknown or changing access patterns
   - Four access tiers:
     - Frequent Access (automatic)
     - Infrequent Access (automatic, 30 days)
     - Archive Instant Access (automatic, 90 days)
     - Archive Access (optional, 90-730+ days)
     - Deep Archive Access (optional, 180-730+ days)

5. **S3 Glacier Flexible Retrieval (formerly S3 Glacier):**
   - Low-cost archival storage
   - Retrieval times: 1-5 minutes (Expedited), 3-5 hours (Standard), 5-12 hours (Bulk)
   - Minimum storage duration: 90 days

6. **S3 Glacier Deep Archive:**
   - Lowest-cost storage class
   - Retrieval time: 12 hours (Standard), 48 hours (Bulk)
   - Minimum storage duration: 180 days
   - Ideal for data accessed once or twice per year

### AWS Console

**Configure Storage Class for New Upload:**
1. Navigate to S3 bucket
2. Click "Upload"
3. Select files
4. Expand "Properties"
5. Under "Storage class" dropdown, select appropriate class
6. Complete upload

**Change Storage Class for Existing Object:**
1. Navigate to object
2. Select object
3. Click "Actions" → "Edit storage class"
4. Select new storage class
5. Save changes

**Configure Lifecycle Policy:**
1. Navigate to bucket
2. Select "Management" tab
3. Click "Create lifecycle rule"
4. Configure rule:
   - Rule name
   - Scope (entire bucket or prefix filter)
   - Lifecycle rule actions:
     - Transition current versions between storage classes
     - Transition previous versions between storage classes
     - Expire current versions
     - Permanently delete previous versions
5. Define transitions:
   - Example: Transition to Standard-IA after 30 days
   - Example: Transition to Glacier after 90 days
   - Example: Expire after 365 days
6. Review and create

### AWS CLI

**Upload Object with Specific Storage Class:**
```bash
# Upload to Standard-IA
aws s3 cp <local-file> s3://<bucket-name>/<key> \
  --storage-class STANDARD_IA

# Upload to Intelligent-Tiering
aws s3 cp <local-file> s3://<bucket-name>/<key> \
  --storage-class INTELLIGENT_TIERING

# Upload to Glacier Flexible Retrieval
aws s3 cp <local-file> s3://<bucket-name>/<key> \
  --storage-class GLACIER

# Upload to Glacier Deep Archive
aws s3 cp <local-file> s3://<bucket-name>/<key> \
  --storage-class DEEP_ARCHIVE
```

**Change Storage Class of Existing Object:**
```bash
aws s3api copy-object \
  --bucket <bucket-name> \
  --copy-source <bucket-name>/<key> \
  --key <key> \
  --storage-class INTELLIGENT_TIERING \
  --metadata-directive COPY
```

**Configure Lifecycle Policy:**
```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket <bucket-name> \
  --lifecycle-configuration file://lifecycle.json
```

**Example lifecycle.json:**
```json
{
  "Rules": [
    {
      "Id": "Archive-old-data",
      "Status": "Enabled",
      "Filter": {
        "Prefix": ""
      },
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "STANDARD_IA"
        },
        {
          "Days": 90,
          "StorageClass": "GLACIER"
        },
        {
          "Days": 365,
          "StorageClass": "DEEP_ARCHIVE"
        }
      ],
      "Expiration": {
        "Days": 2555
      }
    }
  ]
}
```

**Enable Intelligent-Tiering:**
```bash
aws s3api put-bucket-intelligent-tiering-configuration \
  --bucket <bucket-name> \
  --id <config-id> \
  --intelligent-tiering-configuration file://intelligent-tiering.json
```

**Example intelligent-tiering.json:**
```json
{
  "Id": "EntireBucket",
  "Status": "Enabled",
  "Tierings": [
    {
      "Days": 90,
      "AccessTier": "ARCHIVE_ACCESS"
    },
    {
      "Days": 180,
      "AccessTier": "DEEP_ARCHIVE_ACCESS"
    }
  ]
}
```

## Default Value

By default:
- Objects are stored in **S3 Standard** storage class
- No lifecycle policies are configured
- No automatic transitions between storage classes occur
- Intelligent-Tiering must be explicitly enabled

## References

1. https://aws.amazon.com/s3/storage-classes/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ● | ● | ● |
| v8 | 8.3 Ensure Adequate Audit Log Storage<br/>Ensure that logging destinations maintain adequate storage to comply with the enterprise's audit log management process. | ● | ● | ● |
| v7 | 7.8 Implement DMARC and Enable Receiver-Side Verification<br/>To lower the chance of spoofed or modified emails from valid domains, implement Domain-based Message Authentication, Reporting and Conformance (DMARC) policy and verification, starting by implementing the Sender Policy Framework (SPF) and the DomainKeys Identified Mail(DKIM) standards. | | ● | ● |

## Profile
Level 2
