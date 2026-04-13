---
name: cis-aws-database-5.6
description: "Ensure Monitoring and Logging is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, elasticache, redis, monitoring, logging, cloudwatch]
cis_id: "5.6"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-5.9]
prerequisites: []
severity_boost: {}
---

# 5.6 Ensure Monitoring and Logging is Enabled

## Description

Implementing monitoring and logging for Amazon ElastiCache allows you to gain visibility into the performance, health, and behavior of your ElastiCache clusters.

## Rationale

This helps the individual know what is being logged within the activity and determine what next step they should take to address any suspicious activity.

## Impact

If the individual is not monitoring and logging their activity it allows the attacker to attack the system and extract or destroy data.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console
   - Sign in to the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the ElastiCache Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/elasticache/.

3. Select the ElastiCache Cluster
   - Choose the ElastiCache cluster for which you want to implement monitoring and logging.
   - Click on the cluster name to access its details page.

4. Enable Enhanced Monitoring
   - Click on the `Monitoring` tab on the cluster details page.
   - Under the `Monitoring` section, click on the `Enable Enhanced Monitoring` button.
   - Select the desired monitoring granularity (1 minute, 5 minutes, or 60 minutes) to capture detailed metrics.
   - Choose the desired CloudWatch namespace to store the metrics.
   - Click `Save changes` to enable enhanced monitoring for the ElastiCache cluster.

5. Set Up CloudWatch Alarms
   - In the CloudWatch console, navigate to `Alarms` in the left-side menu.
   - Click `Create alarm` to create a new alarm.
   - Select the appropriate ElastiCache metrics from the available options.
   - Configure the threshold, conditions, and actions for the alarm.
   - Choose the actions to take when the alarm state is triggered (e.g., send notifications, auto-scaling actions, etc.).
   - Click `Create alarm` to save the alarm configuration.

6. Configure CloudWatch Logs
   - In the CloudWatch console, navigate to `Logs` in the left-side menu.
   - Click `Create log group` to create a new one.
   - Provide a unique name for the log group and optionally specify a retention period for log data.
   - Click `Create log group` to create the log group.
   - On the ElastiCache cluster details page, click the `Logging` tab.
   - Enable the `CloudWatch Logs` option and select the desired log group from the dropdown menu.
   - Click `Save changes` to enable CloudWatch Logs for the ElastiCache cluster.

7. Verify Monitoring and Logging
   - Wait a few minutes for the monitoring and logging configurations to take effect.
   - Refresh the cluster details page for the updated monitoring and logging status.
   - Navigate to the CloudWatch console to view metrics, alarms, and logs related to your ElastiCache cluster.

## Expected Result

Enhanced monitoring is enabled, CloudWatch alarms are configured, and CloudWatch Logs are enabled for all ElastiCache clusters.

## Remediation

The individual can understand the health, performance, and behavior of their clusters which allows them to address any unusual activity that takes place.

### Using AWS Console

Follow the same steps as the audit procedure to enable monitoring and logging for ElastiCache clusters.

## Default Value

By default, basic monitoring is enabled but enhanced monitoring and CloudWatch Logs require manual configuration.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.1 Establish and Maintain an Audit Log Management Process | x    | x    | x    |
| v7               | 6.2 Activate audit logging                                 | x    | x    | x    |

## Profile

Level 1 | Manual
