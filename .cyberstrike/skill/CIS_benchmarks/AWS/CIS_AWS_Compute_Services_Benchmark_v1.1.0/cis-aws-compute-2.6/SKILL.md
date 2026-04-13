---
name: cis-aws-compute-2.6
description: "Ensure detailed monitoring is enabled for production EC2 Instances"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ec2, monitoring, cloudwatch, detailed-monitoring]
cis_id: "2.6"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-2.9]
prerequisites: []
severity_boost: {}
---

# Ensure detailed monitoring is enabled for production EC2 Instances

## Description
Ensure that detailed monitoring is enabled for your Amazon EC2 instances.

## Rationale
Monitoring is an important part of maintaining the reliability, availability, and performance of your Amazon EC2 instances.

## Impact
Data is available in 1-minute periods. For the instances where you've enabled detailed monitoring, you can also get aggregated data across groups of similar instances. You are charged per metric that is sent to CloudWatch. You are not charged for data storage. Due to this added cost it is recommended that you only enable this on critical instances.

## Audit Procedure

### Using AWS CLI

1. Run the describe-instances command:

```bash
aws ec2 describe-instances --region us-east-1 --output json --filters "Name=monitoring-state,Values=disabled" --query "Reservations[*].Instances[*].{Instance:InstanceId}"
```

2. The output should be a list of running instances that have enhanced monitoring disabled.
3. Based on this list of instance ids refer to the remediation below.

### Using AWS Console

1. Login to EC2 using https://console.aws.amazon.com/ec2/
2. On the left Click `INSTANCES`, click `Instances`.
3. Select the `EC2 instance` you want to review.
4. Select the `Description` tab.
5. Check the `Launch time`.
6. Determine the level of monitoring by reviewing the 'Monitoring attribute'.
7. If the value is set to `basic` refer to the remediation below.
8. Repeat steps no. 3 - 7 to verify the monitoring level for all instances.
9. Go through the other `AWS regions` and repeat the audit process.

## Expected Result
The CLI command should return an empty list, indicating all production instances have detailed monitoring enabled. In the console, the Monitoring attribute should not show `basic` for production instances.

## Remediation

### Using AWS CLI

1. Run the monitor-instances command using the list of instances collected in the audit:

```bash
aws ec2 monitor-instances --instance-ids <i-instancename>
```

2. The output will show 'state: pending'.
3. Wait a few minutes and run the same command again for that instance and it will show enabled.

### Using AWS Console

1. Login to EC2 using https://console.aws.amazon.com/ec2/
2. On the left Click `INSTANCES`, click `Instances`.
3. Select the `EC2 instance` you want to review.
4. Select the `Monitoring` tab.
5. Click on 'Enable Detailed Monitoring'.
6. Click on `Yes, Enable`.
7. Repeat steps no. 3 - 6 for any other instances that require detailed monitoring to be enabled.

## Default Value
By default, EC2 instances use basic monitoring (5-minute intervals). Detailed monitoring (1-minute intervals) must be explicitly enabled.

## References
No specific references provided in the benchmark for this control.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs | x | x | x |
| v7 | 6.2 Activate audit logging | x | x | x |

## Profile
Level 2 | Manual
