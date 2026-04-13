---
name: cis-aws-database-7.8
description: "Ensure to Implement Monitoring and Alerting"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, documentdb, monitoring, cloudwatch, alerting, metrics]
cis_id: "7.8"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-7.6, cis-aws-database-7.11]
prerequisites: []
severity_boost: {}
---

# 7.8 Ensure to Implement Monitoring and Alerting (Manual)

## Description

This helps by alerting the system if any unusual event has occurred or if a particular threshold has been achieved because the user is able to set a desired interval or the cluster. This then allows system administrators to swiftly correct the situation and avoid subsequent complications if something unusual is happening.

## Rationale

Monitoring and alerting mechanisms are essential for detecting performance issues, security events, and operational anomalies in a timely manner.

## Impact

Has a positive impact in the business operations when the issue is identified and addressed accordingly.

## Audit Procedure

### Using AWS Console

1. Sign into the AWS Management Console
   - Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon DocumentDB Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/docdb/.

3. Select the DocumentDB Cluster
   - Choose the Amazon DocumentDB cluster for which you want to implement monitoring and alerting.
   - Click on the cluster name to access its details page.
   - In the cluster details page, navigate to the "Monitoring" section.

4. Enable Enhanced Monitoring
   - Under the `Enhanced Monitoring` section.
   - Click on the `Edit` button or `Modify` option to configure enhanced monitoring settings.
   - Enable the desired metrics and set the desired monitoring interval for the cluster.
   - Enhanced monitoring provides additional insights into the performance and health of your DocumentDB cluster.

5. Set Up CloudWatch Alarms
   - Scroll down to the `CloudWatch Alarms` section.
   - Click on the `Create alarm` button.
   - Configure the CloudWatch alarm based on the metrics you want to monitor and the thresholds you want to set.
   - Specify the actions to be taken when the alarm is triggered, such as sending notifications or executing automated actions.

6. Customize Metrics and Dashboards (Optional)
   - If desired, you can customize the metrics and dashboards in Amazon CloudWatch to suit your specific monitoring requirements.
   - Create custom metrics, build personalized dashboards, and set up alarms based on your application's unique needs.

7. Test Monitoring and Alerting
   - Perform operations on your DocumentDB cluster to generate metric data and trigger the configured alarms.
   - Verify that CloudWatch is capturing the metrics and triggering the appropriate actions based on your alarm settings.

8. Regularly Review and Fine-Tune
   - Regularly review the monitoring metrics, CloudWatch alarms, and any event-driven actions triggered by DocumentDB events.
   - Fine-tune the monitoring settings, alarms, and notifications based on the observed patterns and requirements of your application.

## Expected Result

Enhanced monitoring is enabled, CloudWatch alarms are configured for critical metrics (CPU, memory, connections, replication lag), and alerting mechanisms are in place for all DocumentDB clusters.

## Remediation

### Using AWS Console

Follow the audit procedure steps to enable enhanced monitoring, create CloudWatch alarms, and configure alerting for each DocumentDB cluster.

## Default Value

Amazon DocumentDB publishes basic metrics to CloudWatch automatically. Enhanced monitoring and CloudWatch alarms must be configured manually.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.1 Establish and Maintain an Audit Log Management Process | X    | X    | X    |
| v7               | 6.2 Activate audit logging                                 | X    | X    | X    |

## Profile

Level 1 | Manual
