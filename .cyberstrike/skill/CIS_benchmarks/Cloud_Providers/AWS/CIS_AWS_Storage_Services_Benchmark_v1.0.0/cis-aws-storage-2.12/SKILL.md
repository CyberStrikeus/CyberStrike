---
name: cis-aws-storage-2.12
description: "Ensure Monitoring EC2 and EBS with CloudWatch"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, ebs, ec2, cloudwatch, monitoring, logging, alerting]
cis_id: "2.12"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-2.13]
prerequisites: []
severity_boost: {}
---

# CIS Control 2.12: Ensure Monitoring EC2 and EBS with CloudWatch (Manual)

## Profile Applicability

- **Level 2**

## Description

CloudWatch is an AWS monitoring service that allows you to keep an eye on your AWS resources. You can track metrics via files or worldclass data visuals. AWS CloudWatch allows the administrator to keep an eye on his/her AWS resources. You can set up alarms, monitor activity, and analyze log data. CloudWatch is a must to keep your AWS EBS and EC2 resources secure.

## Rationale

Using CloudWatch to monitor EC2 instances and EBS volumes is essential for enhancing operational oversight and ensuring optimal performance within the AWS environment. This approach provides real-time insights into resource usage and system health, enabling proactive adjustments and timely responses to potential issues, thereby maintaining high availability and efficiency.

## Impact

Failing to monitor EC2 instances and EBS volumes with CloudWatch can lead to delayed detection of performance issues and resource bottlenecks, potentially causing system outages and degraded user experiences. Without this monitoring, organizations also miss opportunities for proactive optimizations, increasing the risk of unexpected downtime and higher operational costs.

## Audit Procedure

Creating an AWS CloudWatch Dashboard - see pages 53-54 of CIS AWS Storage Services Benchmark v1.0.0.

## Remediation

1. Enable CloudWatch Monitoring
2. Configure CloudWatch Alarms
3. Establish Baselines
4. Automate Responses

## References

1. [CloudWatch Embedded Metric Format](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_View.html)

## CIS Controls

| Controls Version | Control                    | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs     | ●    | ●    | ●    |
| v7               | 6.2 Activate audit logging | ●    | ●    | ●    |
| v7               | 6.5 Central Log Management |      | ●    | ●    |
