---
name: cis-aws-foundations-3.1.4
description: "Ensure that S3 is configured with 'Block Public Access' enabled"
category: cis-storage
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, s3, public-access, block-public-access, access-control]
cis_id: "3.1.4"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-3.1.1, cis-aws-foundations-3.1.2, cis-aws-foundations-3.1.3]
prerequisites: []
severity_boost: {}
---

# Ensure that S3 is configured with 'Block Public Access' enabled

## Description
Amazon S3 provides `Block public access (bucket settings)` and `Block public access (account settings)` to help you manage public access to Amazon S3 resources. By default, S3 buckets and objects are created with public access disabled. However, an IAM principal with sufficient S3 permissions can enable public access at the bucket and/or object level. While enabled, `Block public access (bucket settings)` prevents an individual bucket and its contained objects from becoming publicly accessible. Similarly, `Block public access (account settings)` prevents all buckets and their contained objects from becoming publicly accessible across the entire account.

## Rationale
Amazon S3 `Block public access (bucket settings)` prevents the accidental or malicious public exposure of data contained within the respective bucket(s).

Amazon S3 `Block public access (account settings)` prevents the accidental or malicious public exposure of data contained within all buckets of the respective AWS account.

Whether to block public access to all or some buckets is an organizational decision that should be based on data sensitivity, least privilege, and use case.

## Impact
When you apply Block Public Access settings to an account, the settings apply to all AWS regions globally. The settings may not take effect in all regions immediately or simultaneously, but they will eventually propagate to all regions.

## Audit Procedure

### Using AWS Console

**If utilizing Block Public Access (bucket settings):**
1. Login to the AWS Management Console and open the Amazon S3 console using https://console.aws.amazon.com/s3/.
2. Click Bucket name.
3. Click on Permissions tab and check "Block public access (bucket settings)".
4. Ensure that the block public access settings are configured appropriately for this bucket.
5. Repeat for all the buckets in your AWS account.

**If utilizing Block Public Access (account settings):**
1. Login to the AWS Management Console and open the Amazon S3 console using https://console.aws.amazon.com/s3/.
2. Choose `Block public access (account settings)`.
3. Ensure that the block public access settings are configured appropriately for your AWS account.

### Using AWS CLI

**Check bucket-level Block Public Access:**

1. List all the S3 buckets:

```bash
aws s3 ls
```

2. Find the public access settings for a specific bucket:

```bash
aws s3api get-public-access-block --bucket <bucket-name>
```

Output if Block Public Access is enabled:

```json
{
    "PublicAccessBlockConfiguration": {
        "BlockPublicAcls": true,
        "IgnorePublicAcls": true,
        "BlockPublicPolicy": true,
        "RestrictPublicBuckets": true
    }
}
```

If the output reads `false` for the separate configuration settings, then proceed with the remediation.

**Check account-level Block Public Access:**

```bash
aws s3control get-public-access-block --account-id <account-id> --region <region-name>
```

Output if Block Public Access is enabled:

```json
{
    "PublicAccessBlockConfiguration": {
        "IgnorePublicAcls": true,
        "BlockPublicPolicy": true,
        "BlockPublicAcls": true,
        "RestrictPublicBuckets": true
    }
}
```

If the output reads `false` for the separate configuration settings, then proceed with the remediation.

## Expected Result
All four Block Public Access settings should be set to `true`:
- `BlockPublicAcls`: true
- `IgnorePublicAcls`: true
- `BlockPublicPolicy`: true
- `RestrictPublicBuckets`: true

This should be verified at either the bucket level or account level, depending on organizational requirements.

## Remediation

### Using AWS Console

**If utilizing Block Public Access (bucket settings):**
1. Login to the AWS Management Console and open the Amazon S3 console using https://console.aws.amazon.com/s3/.
2. Select the check box next to a bucket.
3. Click 'Edit public access settings'.
4. Click 'Block all public access'
5. Repeat for all the buckets in your AWS account that contain sensitive data.

**If utilizing Block Public Access (account settings):**
1. Login to the AWS Management Console and open the Amazon S3 console using https://console.aws.amazon.com/s3/.
2. Click `Block Public Access (account settings)`.
3. Click `Edit` to change the block public access settings for all the buckets in your AWS account.
4. Update the settings and click `Save`.
5. When you're asked for confirmation, enter `confirm`. Then click `Confirm` to save your changes.

### Using AWS CLI

**Enable Block Public Access on a specific bucket:**

```bash
aws s3api put-public-access-block --bucket <bucket-name> --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

**Enable Block Public Access for the account:**

```bash
aws s3control put-public-access-block \
--public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true, BlockPublicPolicy=true, RestrictPublicBuckets=true \
--account-id <account-id>
```

## Default Value
By default, new S3 buckets and objects are created with public access disabled, but the Block Public Access settings (at the bucket or account level) are not enforced. They must be explicitly enabled to prevent future public access changes.

## References
1. https://docs.aws.amazon.com/AmazonS3/latest/user-guide/block-public-access-account.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1530 | TA0009 | M1022 |

## Profile
Level 1 | Automated
