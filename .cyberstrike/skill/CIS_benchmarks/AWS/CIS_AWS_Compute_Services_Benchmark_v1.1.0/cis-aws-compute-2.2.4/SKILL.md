---
name: cis-aws-compute-2.2.4
description: "Ensure unused EBS volumes are removed"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, ebs, volumes, unused, cleanup]
cis_id: "2.2.4"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.2.1, cis-aws-compute-2.12]
prerequisites: []
severity_boost: {}
---

# Ensure unused EBS volumes are removed

## Description

Identify any unused Elastic Block Store (EBS) volumes in your AWS account and remove them.

## Rationale

Any Elastic Block Store volume created in your AWS account contains data, regardless of being used or not. If you have EBS volumes (other than root volumes) that are unattached to an EC2 instance they should be removed to prevent unauthorized access or data leak to any sensitive data on these volumes.

## Impact

Once a EBS volume is deleted, the data will be lost. If this is data that you need to archive, create an encrypted EBS snapshot before deleting them.

## Audit Procedure

### Using AWS CLI

1. Run describe-volumes:

```bash
aws ec2 describe-volumes --filter Name=status,Values=available --query "Volumes[*].{ID:VolumeId}"
```

2. This will provide a list of all the volumes not attached to an instance.

Capture this list of volume names and refer to the remediation below.

Note: EBS volumes can be in different regions. Make sure to review all the regions being utilized.

### Using AWS Console

1. Login to the EC2 console using https://console.aws.amazon.com/ec2/
2. Under `Elastic Block Store`, click `Volumes`.
3. Find the `State` column.
4. Sort by `Available`.
5. Any `Volumes` listed as Available can be deleted as that is the indication the volume is not attached to an instance.

Capture this list of volume names and refer to the remediation below.

Note: EBS volumes can be in different regions. Make sure to review all the regions being utilized.

## Expected Result

The CLI command should return an empty list, indicating no unattached EBS volumes exist. In the console, no volumes should be in the `Available` state.

## Remediation

### Using AWS CLI

Using the list of `available volumes` identified in the Audit above:

1. Run the delete-volume command:

```bash
aws ec2 delete-volume --volume-id <vol-name>
```

2. This will delete the volume identified.

Note: Using this command will not prompt you for confirmation. It will delete the volume and you will not be able to recover it. Please make sure you have the correct volume and that you have created a snapshot if it is something that needs to be archived.

Note: EBS volumes can be in different regions. Make sure to review all the regions being utilized.

### Using AWS Console

1. Login to the EC2 console using https://console.aws.amazon.com/ec2/
2. Under `Elastic Block Store`, click `Volumes`.
3. Find the `State` column.
4. Sort by `Available`.
5. Select the Volume that you want to delete.
6. Click `Actions, Delete volume, Yes, Delete`.

Note: EBS volumes can be in different regions. Make sure to review all the regions being utilized.

## Default Value

EBS volumes remain in the account after being detached from instances. AWS does not automatically clean up unused volumes.

## References

1. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/describe-volumes.html
2. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/delete-volume.html

## CIS Controls

| Controls Version | Control                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 1.1 Establish and Maintain Detailed Enterprise Asset Inventory | x    | x    | x    |
| v7               | 1.4 Maintain Detailed Asset Inventory                          | x    | x    | x    |

## Profile

Level 1 | Manual
