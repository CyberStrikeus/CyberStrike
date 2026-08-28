---
name: cis-aws-compute-2.1.2
description: "Ensure Amazon Machine Images (AMIs) are encrypted"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, ami, encryption, ebs]
cis_id: "2.1.2"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.1.1, cis-aws-compute-2.2.1, cis-aws-compute-2.2.3]
prerequisites: []
severity_boost: {}
---

# Ensure Amazon Machine Images (AMIs) are encrypted

## Description

Amazon Machine Images should utilize EBS Encrypted snapshots.

## Rationale

AMIs backed by EBS snapshots should use EBS encryption. Snapshot volumes can be encrypted and attached to an AMI.

## Impact

Encrypting AMIs may add slight overhead to instance launch times and requires KMS key management. Existing unencrypted AMIs must be copied with encryption enabled and old ones deregistered.

## Audit Procedure

### Using AWS CLI

1. Run the aws ec2 describe-images command to find unencrypted AMIs:

```bash
aws ec2 describe-images --region us-east-1 --owner self --filter "Name=block-device-mapping.encrypted,Values=false" --query "Images[*].[ImageId]"
```

2. If this produces a list of AMI's make note as these are not encrypted, then refer to the remediation below.

### Using AWS Console

1. Login to the IAM console at https://console.aws.amazon.com/ec2/.
2. In the left pane click `Instances`, click `AMIs`.
3. In the `Details` tab.
4. Review the 'Block Devices'.
5. Confirm that it ends with `encrypted`.

If it doesn't end with encrypted, refer to the remediation below.

## Expected Result

The CLI command should return an empty list, indicating all AMIs use encrypted EBS snapshots. In the console, all AMI block devices should show as `encrypted`.

## Remediation

### Using AWS CLI

1. Run the aws ec2 copy-image command to copy AMI with encrypted block device:

```bash
aws ec2 copy-image --name <New_AMI_Name> --source-image-id <Image-ID> --source-region <region> --encrypted
```

2. Run aws ec2 deregister-image to deregister older AMIs:

```bash
aws ec2 deregister-image --image-id <Image-ID>
```

### Using AWS Console

1. Login to the EC2 console at https://console.aws.amazon.com/ec2/.
2. In the left pane click on `AMIs`.
3. Select the AMI that does not comply to the encryption policy.
4. Click on `Actions`.
5. Click on `Copy AMI`.

```
Destination region - `Select the region the AMI is in`.
Name - `Enter the new Name`
Description - `Enter the new description`
Encryption - `Select` Encrypt target EBS snapshots
```

6. Click on Copy AMI.

Once the AMI has finished copying:

7. Select the AMI that does not have encrypted EBS snapshots.
8. Click on `Actions`.
9. Click on `Deregister`.

## Default Value

By default, AMIs are not encrypted. EBS encryption must be explicitly enabled when creating or copying AMIs.

## References

1. https://aws.amazon.com/premiumsupport/knowledge-center/view-ami-snapshot-encryption-details/
2. https://docs.aws.amazon.com/AWSEC2/latest/WindowsGuide/AMIEncryption.html
3. https://docs.aws.amazon.com/cli/latest/reference/ec2/copy-image.html
4. https://docs.aws.amazon.com/cli/latest/reference/ec2/deregister-image.html
5. https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DeregisterImage.html
6. https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CopyImage.html

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest        |      | x    | x    |
| v7               | 14.8 Encrypt Sensitive Information at Rest |      |      | x    |

## Profile

Level 1 | Automated
