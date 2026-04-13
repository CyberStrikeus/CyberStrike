---
name: cis-aws-foundations-6.1.1
description: "Ensure EBS volume encryption is enabled in all regions"
category: cis-networking
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, networking, ec2, ebs, encryption]
cis_id: "6.1.1"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-6.1.2]
prerequisites: []
severity_boost: {}
---

# Ensure EBS volume encryption is enabled in all regions

## Description
Elastic Compute Cloud (EC2) supports encryption at rest when using the Elastic Block Store (EBS) service. While disabled by default, forcing encryption at EBS volume creation is supported.

## Rationale
Encrypting data at rest reduces the likelihood of unintentional exposure and can nullify the impact of disclosure if the encryption remains unbroken.

## Impact
Losing access to or removing the KMS key used by the EBS volumes will result in the inability to access the volumes.

## Audit Procedure

### Using AWS Console
1. Login to the AWS Management Console and open the Amazon EC2 console using https://console.aws.amazon.com/ec2/.
2. Under `Account attributes`, click `Data Protection and Security`.
3. Under `EBS encryption`, verify that `Always encrypt new EBS volumes` displays `Enabled`.
4. Repeat for each region in use.

**Note:** EBS volume encryption is configured per region.

### Using AWS CLI
1. Run the following command:

```bash
aws --region <region> ec2 get-ebs-encryption-by-default
```

2. Verify that `"EbsEncryptionByDefault": true` is displayed.
3. Repeat for each region in use.

## Expected Result
`"EbsEncryptionByDefault": true` should be displayed for every region in use.

## Remediation

### Using AWS Console
1. Login to the AWS Management Console and open the Amazon EC2 console using https://console.aws.amazon.com/ec2/.
2. Under `Account attributes`, click `Data protection and security`.
3. Under `EBS encryption`, Click `Manage`.
4. Check the `Enable` box to default encryption.
5. Click `Update EBS encryption`.
6. Repeat for each region in which EBS volume encryption is not enabled by default.

### Using AWS CLI
1. Run the following command:

```bash
aws --region <region> ec2 enable-ebs-encryption-by-default
```

2. Verify that `"EbsEncryptionByDefault": true` is displayed.
3. Repeat for each region in which EBS volume encryption is not enabled by default.

**Note:** EBS volume encryption is configured per region.

## Default Value
By default, EBS volume encryption is disabled. It must be manually enabled per region; otherwise, new EBS volumes are created unencrypted.

## References
1. https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EBSEncryption.html
2. https://aws.amazon.com/blogs/aws/new-opt-in-to-default-encryption-for-new-ebs-volumes/

## Additional Information
Default EBS volume encryption only applies to newly created EBS volumes; existing EBS volumes are **not** converted automatically.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | x | x |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1530 | TA0009 | M1041 |

## Profile
Level 1 | Automated
