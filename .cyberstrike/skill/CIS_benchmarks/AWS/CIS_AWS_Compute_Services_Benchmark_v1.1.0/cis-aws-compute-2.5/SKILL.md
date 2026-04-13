---
name: cis-aws-compute-2.5
description: "Ensure no AWS EC2 Instances are Older than 180 days"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, instance-age, lifecycle, patching]
cis_id: "2.5"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.1.4, cis-aws-compute-2.11]
prerequisites: []
severity_boost: {}
---

# Ensure no AWS EC2 Instances are Older than 180 days

## Description
Identify any running AWS EC2 instances older than 180 days.

## Rationale
An EC2 instance is not supposed to run indefinitely and having instance older than 180 days can increase the risk of problems and issues.

## Impact
Stopping and restarting instances will change the launch time and may cause temporary service disruption. Plan for maintenance windows when refreshing long-running instances.

## Audit Procedure

### Using AWS CLI

1. Run the describe-instances command:

```bash
aws ec2 describe-instances --region us-east-1 --output json --filters "Name=instance-state-code,Values=16" --query "Reservations[*].Instances[*].{Instance:InstanceId}"
```

2. The output should look like this:

```json
[
    [
        {
            "Instance": "i-1234567abcdefghi0"
        }
    ],
    [
        {
            "Instance": "i-1234567abcdefghi0"
        }
    ]
]
```

3. Run the describe-instances command for each instance ID listed:

```bash
aws ec2 describe-instances --region us-east-1 --instance-ids i-1234567abcdefghi0 --query "Reservations[*].Instances[*].LaunchTime"
```

4. The command output should return the instance launch date in human readable format:

```
"2021-06-11T15:04:52+00:00"
```

5. If the selected instance was launched more than 180 days ago, refer to the remediation below.
6. Repeat steps 3 and 4 to verify the launch date for all instances listed.
7. Repeat steps 1 - 6 for the other AWS regions.

### Using AWS Console

1. Login to EC2 using https://console.aws.amazon.com/ec2/
2. On the left Click `INSTANCES`, click `Instances`.
3. Select the `EC2 instance`. The Instance State must be 'running'.
4. Select the `Description` tab.
5. Check the `Launch time`.
6. Determine the `instance active age`.
7. If the selected EC2 instance active age is greater than 180 days, refer to the remediation below.
8. Repeat steps no. 3 - 7 to verify the launch date for all instances.
9. Go through the other `AWS regions` and repeat the audit process.

## Expected Result
No running EC2 instance should have a LaunchTime older than 180 days.

## Remediation

### Using AWS CLI
No specific CLI remediation command is provided. Use the console method below.

### Using AWS Console

1. Login to EC2 using https://console.aws.amazon.com/ec2/
2. On the left Click `INSTANCES`, click `Instances`.
3. Select the `EC2 instance` identified above in the audit. The Instance State must be 'running'.
4. Click `Actions`, click `Instance State`, click `Stop`.
5. Wait for the Instance State to read 'stopped'.
6. Click 'Actions' click 'Instance State', click 'Start'.
7. Select the Description tab.
8. Check the Launch time.

Confirm that the instance active age is now set to today's date and time.

## Default Value
AWS does not enforce any default age limit on running EC2 instances.

## References
No specific references provided in the benchmark for this control.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 1.1 Establish and Maintain Detailed Enterprise Asset Inventory | x | x | x |
| v7 | 1.4 Maintain Detailed Asset Inventory | x | x | x |

## Profile
Level 1 | Manual
