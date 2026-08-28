---
name: cis-aws-compute-2.2.1
description: "Ensure EBS volume encryption is enabled"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, ebs, encryption, volumes]
cis_id: "2.2.1"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.1.2, cis-aws-compute-2.2.3]
prerequisites: []
severity_boost: {}
---

# Ensure EBS volume encryption is enabled

## Description

Elastic Compute Cloud (EC2) supports encryption at rest when using the Elastic Block Store (EBS) service. While disabled by default, forcing encryption at EBS volume creation is supported.

## Rationale

Encrypting data at rest reduces the likelihood that it is unintentionally exposed and can nullify the impact of disclosure if the encryption remains unbroken.

## Impact

Enabling EBS encryption by default applies to all new volumes. Existing unencrypted volumes are not affected. This is configured per region.

## Audit Procedure

### Using AWS CLI

1. Run:

```bash
aws --region <region> ec2 get-ebs-encryption-by-default
```

2. Verify that `"EbsEncryptionByDefault": true` is displayed.
3. Review every region in-use.

Note: EBS volume encryption is configured per region.

### Using AWS Console

1. Login to the EC2 console using https://console.aws.amazon.com/ec2/
2. Under `Account attributes`, click `EBS encryption`.
3. Verify `Always encrypt new EBS volumes` displays `Enabled`.
4. Review every region in-use.

Note: EBS volume encryption is configured per region.

## Expected Result

The CLI should return `"EbsEncryptionByDefault": true` for every region in use. In the console, `Always encrypt new EBS volumes` should display `Enabled`.

## Remediation

### Using AWS CLI

1. Run:

```bash
aws --region <region> ec2 enable-ebs-encryption-by-default
```

2. Verify that `"EbsEncryptionByDefault": true` is displayed.
3. Repeat every region requiring the change.

Note: EBS volume encryption is configured per region.

### Using AWS Console

1. Login to the EC2 console using https://console.aws.amazon.com/ec2/
2. Under `Account attributes`, click `EBS encryption`.
3. Click `Manage`.
4. Click the `Enable` checkbox.
5. Click `Update EBS encryption`.
6. Repeat for every region requiring the change.

Note: EBS volume encryption is configured per region.

## Default Value

EBS encryption by default is disabled. It must be explicitly enabled per region.

## References

1. https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EBSEncryption.html
2. https://aws.amazon.com/blogs/aws/new-opt-in-to-default-encryption-for-new-ebs-volumes/
3. AWS Config rule - ec2_ebs_encryption_by_default

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest        |      | x    | x    |
| v7               | 14.8 Encrypt Sensitive Information at Rest |      |      | x    |

## Profile

Level 1 | Automated
