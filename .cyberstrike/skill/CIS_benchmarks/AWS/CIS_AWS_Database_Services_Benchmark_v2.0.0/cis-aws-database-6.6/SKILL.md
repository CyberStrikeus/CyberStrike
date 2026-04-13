---
name: cis-aws-database-6.6
description: "Ensure Monitoring and Alerting is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, memorydb, redis, monitoring, cloudwatch, alerting, eventbridge]
cis_id: "6.6"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-6.4, cis-aws-database-6.5]
prerequisites: []
severity_boost: {}
---

# 6.6 Ensure Monitoring and Alerting is Enabled (Manual)

## Description

Implementing monitoring and alerting on Amazon MemoryDB allows you to proactively detect and respond to any performance issues, security events, or operational anomalies.

## Rationale

This helps in ensuring that everything in the system is secure and if there is an unusual activity that takes place it addresses the issues quickly and efficiently.

## Impact

Enabling monitoring and alerting has a positive impact in the business operations when the issue is identified and addressed accordingly.

## Audit Procedure

### Using AWS Console

1. Sign into the AWS Management Console
   - Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon MemoryDB Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/memorydb/.

3. Select the Cluster
   - Choose the Amazon MemoryDB cluster for which you want to implement monitoring and alerting. Click on the cluster name to access its details page.

4. Enable Amazon CloudWatch
   - In the cluster details page, navigate to the `Monitoring` or `CloudWatch` section.
   - Click on `Enable` to enable CloudWatch monitoring for the cluster.
   - Select the appropriate CloudWatch metric categories to monitor, such as CPU utilization, memory utilization, network traffic, and storage capacity.
   - Configure the desired granularity and period for metric collection.
   - Click `Enable` or `Save` to enable CloudWatch monitoring for the cluster.

5. Set Up CloudWatch Alarms
   - In the CloudWatch console, navigate to `Alarms` in the left-side menu.
   - Click on `Create Alarm` to set up a new alarm.
   - Select the CloudWatch metric related to the aspect you want to monitor, such as CPU utilization or memory utilization.
   - Configure the alarm threshold based on your desired criteria, such as setting CPU utilization above a certain percentage.
   - Define the actions to be taken when the alarm is triggered.
   - Click `Create Alarm` to create the CloudWatch alarm.

6. Configure Amazon EventBridge Rules (Optional)
   - In the Amazon EventBridge console, navigate to `Rules` in the left-side menu.
   - Click on `Create rule` to set up a new rule.
   - Define the event pattern or source that should trigger the rule, such as specific MemoryDB events or errors.
   - Configure the target actions, such as sending notifications, executing AWS Lambda functions, or invoking AWS Step Functions.
   - Click `Create` to create the EventBridge rule.

7. Configure Auto Scaling (Optional)
   - In the MemoryDB cluster details page, navigate to the `Auto Scaling` section.
   - Configure auto-scaling settings based on your workload and performance requirements.
   - Define the scaling policies, such as increasing or decreasing the number of replica nodes based on CPU utilization or other metrics.
   - Set the desired minimum and maximum number of replica nodes for the cluster.
   - Click `Save` or `Apply Changes` to apply the auto-scaling configuration.

8. Regularly Review and Adjust Monitoring and Alarms
   - Periodically review the CloudWatch metrics and alarms to ensure they align with your monitoring needs and performance expectations.
   - Adjust the thresholds and actions based on changing workload patterns or performance requirements.
   - Stay informed about new CloudWatch features and best practices to optimize your monitoring setup.

## Expected Result

CloudWatch monitoring is enabled with appropriate metrics, alarms are configured for critical thresholds, and alerting mechanisms are in place for all MemoryDB clusters.

## Remediation

### Using AWS Console

Follow the audit procedure steps to enable CloudWatch monitoring, create alarms, and configure EventBridge rules for each MemoryDB cluster.

## Default Value

Amazon MemoryDB publishes metrics to CloudWatch automatically. CloudWatch alarms and EventBridge rules must be configured manually.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.1 Establish and Maintain an Audit Log Management Process | X    | X    | X    |
| v7               | 6.2 Activate audit logging                                 | X    | X    | X    |

## Profile

Level 1 | Manual
