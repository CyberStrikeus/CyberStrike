---
name: cis-aws-compute-2.12
description: "Ensure EBS volumes attached to an EC2 instance are marked for deletion upon instance termination"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, ebs, delete-on-termination, lifecycle]
cis_id: "2.12"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.2.4, cis-aws-compute-2.11]
prerequisites: []
severity_boost: {}
---

# Ensure EBS volumes attached to an EC2 instance are marked for deletion upon instance termination

## Description
This rule ensures that Amazon Elastic Block Store volumes that are attached to Amazon Elastic Compute Cloud (Amazon EC2) instances are marked for deletion when an instance is terminated. If an Amazon EBS volume isn't deleted when the instance that it's attached to is terminated, it may violate the concept of least functionality.

## Rationale
Orphaned EBS volumes after instance termination can contain sensitive data and increase costs. Marking volumes for deletion on termination ensures cleanup.

## Impact
Data on the EBS volume will be permanently lost when the instance is terminated. Ensure important data is backed up before enabling this setting.

## Audit Procedure

### Using AWS CLI

1. Run the describe-instances command:

```bash
aws ec2 describe-instances --region us-east-1 --output json --filters "Name=block-device-mapping.delete-on-termination,Values=false" --query "Reservations[*].Instances[*].{Instance:InstanceId}"
```

2. The output should be a list of instances that have not set 'Delete on termination'.
3. Make note of the list of instance ids and refer to the remediation below.
4. Repeat steps no. 1 -3 with the other `AWS regions`.

### Using AWS Console

1. Login to EC2 using https://console.aws.amazon.com/ec2/
2. On the left Click `INSTANCES`, click `Instances`.
3. Select the `EC2 instance` you want to review.
4. Select the `Storage` tab.
5. Scroll down until you reach the 'Volume ID' and review the setting for 'Delete on termination'.
6. If the value is set to `No` refer to the remediation below.
7. Repeat steps no. 3 - 6 to verify the setting.
8. Go through the other `AWS regions` and repeat the audit process for all instances.

## Expected Result
The CLI command should return an empty list, indicating all EBS volumes attached to instances have `DeleteOnTermination` set to `true`.

## Remediation

### Using AWS CLI

1. Run the modify-instance-attribute command using the list of instances collected in the audit:

```bash
aws ec2 modify-instance-attribute --instance-id i-123456abcdefghi0 --block-device-mappings "[{\"DeviceName\": \"/dev/sda\",\"Ebs\":{\"DeleteOnTermination\":true}}]"
```

2. Repeat steps no. 1 with the other instances discovered in all `AWS regions`.

**Note:** If you get any errors running the modify-instance-attribute command confirm the instance id and the Device Name for that instance is correct. The above command is referencing the typical default device name.

### Using AWS Console

1. At this time the `delete on termination` setting for existing instances can only be changed using AWS CLI.

## Default Value
By default, the root EBS volume is marked for deletion on termination, but additional attached volumes are not.

## References
1. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/modify-instance-attribute.html
2. https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInstances.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 1.1 Establish and Maintain Detailed Enterprise Asset Inventory | x | x | x |
| v7 | 1.4 Maintain Detailed Asset Inventory | x | x | x |

## Profile
Level 1 | Manual
