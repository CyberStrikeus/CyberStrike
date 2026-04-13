---
name: cis-aws-database-10.8
description: "Ensure Monitoring and Alerting is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, timestream, time-series, monitoring, cloudwatch, alerting]
cis_id: "10.8"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-10.6, cis-aws-database-10.7, cis-aws-database-10.9]
prerequisites: []
severity_boost: {}
---

# 10.8 Ensure Monitoring and Alerting is Enabled (Manual)

## Description

Utilize Amazon CloudWatch to monitor key metrics, events, and logs related to Amazon Timestream. Set up appropriate alarms and notifications to detect security incidents or abnormal behavior proactively.

## Rationale

This helps the individual know what is being logged within the activity and determine what next step should be if they spot any anomalies.

## Impact

Proper monitoring and alerting enables proactive detection of performance issues, security incidents, and operational anomalies in Timestream.

## Audit Procedure

### Using AWS Console

1. Define Monitoring Objectives:
   - Determine the key metrics, events, and logs you want to monitor in Amazon Timestream. Identify the specific monitoring requirements based on your use case, workload, and business needs.
2. Choose Monitoring Tools:
   - Evaluate the available monitoring tools for Amazon Timestream, such as AWS CloudWatch, third-party monitoring solutions, or custom-built monitoring systems. Select the monitoring tool that best aligns with your monitoring objectives and requirements.
3. Configure CloudWatch Metrics:
   - Utilize Amazon CloudWatch to monitor key performance metrics of Timestream. Enable and configure CloudWatch metrics such as database CPU utilization, storage usage, query latency, and other relevant metrics. Set appropriate thresholds for these metrics to trigger alarms and notifications.
4. Create CloudWatch Alarms:
   - Set up CloudWatch alarms based on your defined thresholds and monitoring objectives. Define the conditions that trigger the alarms, such as CPU utilization exceeding a certain percentage or query latency exceeding a specific threshold. Configure the notification actions for the alarms, such as sending notifications via email, SMS, or triggering automated actions.
5. Enable Enhanced Monitoring (Optional):
   - Consider enabling enhanced monitoring for Timestream, which provides more detailed performance metrics. Configure the enhanced monitoring settings to collect additional metrics that provide deeper insights into the health and performance of Timestream.
6. Configure Log Streams and Filters:
   - Enable Timestream's integration with AWS CloudWatch Logs. Configure log streams and filters to capture and centralize Timestream logs into CloudWatch Logs. Define relevant log filters to extract and track specific log events for monitoring purposes.
7. Regularly Review and Analyze Monitoring Data:
   - Continuously review the monitoring data and metrics CloudWatch provides or your chosen monitoring tool. Analyze the data to identify performance bottlenecks, anomalies, or issues in your Timestream implementation. Take necessary actions based on the monitoring insights to optimize performance, improve resource utilization, or troubleshoot issues.
8. Periodically Review and Adjust Monitoring Configuration:
   - Regularly review your monitoring configuration to ensure it aligns with your evolving requirements and workload. Adjust your monitoring setup, such as adding or modifying metrics, updating alarm thresholds, or incorporating new log filters.

## Expected Result

CloudWatch metrics, alarms, and log streams should be properly configured to provide comprehensive monitoring and alerting for Timestream resources.

## Remediation

### Using AWS Console

Follow the audit steps above to configure CloudWatch monitoring and alerting for your Amazon Timestream resources.

## Default Value

Basic CloudWatch metrics are available for Timestream. Alarms, enhanced monitoring, and log integrations must be manually configured.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.1 Establish and Maintain an Audit Log Management Process | x    | x    | x    |
| v7               | 6.2 Activate audit logging                                 | x    | x    | x    |

## Profile

Level 1 | Manual
