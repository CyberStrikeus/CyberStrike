---
name: cis-aws-compute-2.2.3
description: "Ensure EBS volume snapshots are encrypted"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, ebs, snapshots, encryption]
cis_id: "2.2.3"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.2.1, cis-aws-compute-2.2.2, cis-aws-compute-2.1.2]
prerequisites: []
severity_boost: {}
---

# Ensure EBS volume snapshots are encrypted

## Description
Elastic Compute Cloud (EC2) supports encryption at rest when using the Elastic Block Store (EBS) service.

## Rationale
Encrypting data at rest reduces the likelihood that it is unintentionally exposed and can nullify the impact of disclosure if the encryption remains unbroken.

## Impact
Existing unencrypted snapshots must be copied with encryption enabled. The original unencrypted snapshots should then be deleted. EBS snapshot volume encryption is configured per snapshot.

## Audit Procedure

### Using AWS CLI

1. Run describe-snapshots:

```bash
aws ec2 describe-snapshots --owner-ids <account number> --filter Name=status,Values=completed --query "Snapshots[*].{ID:SnapshotId}"
```

2. This will provide a list of all the snapshots associated with that account in the region.

3. For every snapshot listed - Run describe-snapshots:

```bash
aws ec2 describe-snapshots --snapshot-id <snap-name> --query "Snapshots[*].{Encrypt:Encrypted}"
```

4. If the output reads `"Encrypt": true`, Encryption is set on the snapshot.

If the output reads `"Encrypt": false` refer to the remediation below.

Note: EBS snapshot volume encryption is configured per snapshot.

### Using AWS Console

1. Login to the EC2 console using https://console.aws.amazon.com/ec2/
2. Under `Elastic Block Store`, click `Snapshots`.
3. Click the snapshot you want to review.
4. Select the `Description` tab.
5. Review the `Encryption` setting.
6. If it reads `encrypted` you are all set.

If it is set to `Not Encrypted` refer to the remediation below.

Note: EBS snapshot volume encryption is configured per snapshot.

## Expected Result
All snapshots should return `"Encrypt": true` from the CLI. In the console, all snapshots should show as `encrypted` in the Encryption field.

## Remediation

### Using AWS CLI

Using the snapshot ids gathered from the Audit section:

1. Run copy-snapshot:

```bash
aws ec2 copy-snapshot --source-region <region> --source-snapshot-id <snap-id> --description "Name of the new snapshot" --encrypted
```

2. This will copy the existing unencrypted snapshot and set it to encrypted. The output will show the new SnapshotId.

3. Run describe-snapshots:

```bash
aws ec2 describe-snapshots --owner-ids <account id> --filter Name=status,Values=completed --query "Snapshots[*].{ID:SnapshotId}"
```

Once the new Snapshot shows in the list confirm encryption is set:

4. Run describe-snapshots:

```bash
aws ec2 describe-snapshots --snapshot-id <snap-name> --query "Snapshots[*].{Encrypt:Encrypted}"
```

5. Repeat steps 1-4 for the snapshots that need to be encrypted.

Delete snapshots that are no longer needed:

6. Run delete-snapshot:

```bash
aws ec2 delete-snapshot --snapshot-id <snap-name>
```

7. Repeat for all unencrypted snapshots that have been copied and encrypted.

Note: EBS snapshot volume encryption is configured per snapshot.

### Using AWS Console

1. Login to the EC2 console using https://console.aws.amazon.com/ec2/
2. Under `Elastic Block Store`, click `Snapshots`.
3. Select the snapshot you want to encrypt.
4. Click on `Actions` select `Copy`.

```
Confirm `Snapshot ID`
Set the `Destination Region`
Update the `Description`
Select the check box for `Encryption`
```

5. Check the box for `Encrypt this snapshot`.
6. Set the `Master Key`.
7. Click on `Copy`.
8. Repeat steps 3-7 for the snapshots that need to be encrypted.
9. Delete any of the unencrypted snapshots that are not longer needed.

Note: EBS snapshot volume encryption is configured per snapshot.

## Default Value
By default, EBS snapshots are not encrypted. Encryption must be explicitly enabled when creating or copying snapshots.

## References
1. https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EBSEncryption.html
2. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/describe-snapshots.html
3. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/delete-snapshot.html
4. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/copy-snapshot.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | x | x |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | x |

## Profile
Level 1 | Automated
