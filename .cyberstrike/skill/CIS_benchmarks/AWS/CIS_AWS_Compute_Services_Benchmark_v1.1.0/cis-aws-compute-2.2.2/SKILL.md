---
name: cis-aws-compute-2.2.2
description: "Ensure Public Access to EBS Snapshots is Disabled"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, ebs, snapshots, public-access, permissions]
cis_id: "2.2.2"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.1.5, cis-aws-compute-2.2.3, cis-aws-compute-2.2.4]
prerequisites: []
severity_boost: {}
---

# Ensure Public Access to EBS Snapshots is Disabled

## Description
To protect your data disable the public mode of EBS snapshots.

## Rationale
This protects your data so that it is not accessible to all AWS accounts preventing accidental access and leaks.

## Impact
Removing public access from EBS snapshots may affect other AWS accounts that rely on them. Ensure private sharing is configured for any authorized accounts.

## Audit Procedure

### Using AWS CLI

1. For each snapshot, run:

```bash
aws ec2 describe-snapshot-attribute \
    --snapshot-id <snapshot-ID> \
    --attribute createVolumePermission
```

2. Validate `Group` is not set to all.

### Using AWS Console

1. Login to the EC2 console at https://console.aws.amazon.com/ec2/.
2. In the left pane click `Snapshots`.
3. Select the `snapshot` then click `Actions, Modify Permissions`.
4. Confirm that the snapshot is set to `Private`.
5. Repeat for any additional Snapshots, Regions and AWS accounts.

If the snapshot is set to public refer to the remediation below.

## Expected Result
The createVolumePermission attribute should not contain a Group set to "all". In the console, all snapshots should show as Private.

## Remediation

### Using AWS CLI

1. For each snapshot, run:

```bash
aws ec2 modify-snapshot-attribute \
    --snapshot-id <snapshot-ID> \
    --attribute createVolumePermission \
    --operation remove --group-name all
```

### Using AWS Console

1. Login to the EC2 console at https://console.aws.amazon.com/ec2/.
2. In the left pane click `Snapshots`.
3. Select the `snapshot` then click 'Actions, Modify Permissions'.
4. Click the radio button for `Private`.
5. Click `Save`.
6. Repeat for any additional Snapshots, Regions and AWS accounts.

## Default Value
By default, EBS snapshots are private when created.

## References
1. https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EBSSnapshots.html
2. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/describe-snapshot-attribute.html

## Additional Information
1. Snapshots are constrained to the Region in which they were created. To share a snapshot with another Region, copy the snapshot to that Region.
2. AWS prevents you from sharing snapshots that were encrypted with your default CMK. Snapshots that you intend to share must instead be encrypted with a customer managed CMK.
3. The public option is not valid for encrypted snapshots or snapshots with an AWS Marketplace product code.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## Profile
Level 1 | Automated
