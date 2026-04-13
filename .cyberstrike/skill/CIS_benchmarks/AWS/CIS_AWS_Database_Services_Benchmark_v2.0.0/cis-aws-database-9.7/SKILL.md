---
name: cis-aws-database-9.7
description: "Ensure Monitoring and Alerting is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, neptune, graph-database, monitoring, cloudwatch, alerting]
cis_id: "9.7"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-9.5, cis-aws-database-9.6, cis-aws-database-9.8]
prerequisites: []
severity_boost: {}
---

# 9.7 Ensure Monitoring and Alerting is Enabled (Manual)

## Description

Ensure that monitoring and alerting is enabled for Amazon Neptune clusters to detect performance issues, security incidents, and operational anomalies proactively.

## Rationale

Monitoring and alerting provides visibility into Neptune cluster operations, enabling proactive detection of performance issues, security incidents, and abnormal behavior.

## Impact

Proper monitoring and alerting enables timely response to critical conditions and helps maintain the security and performance of Neptune clusters.

## Audit Procedure

### Using AWS Console

1. Sign in to the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.
2. Open the Amazon Neptune Console - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/neptune/.
3. Select the Neptune Cluster:
   - Choose the Amazon Neptune cluster on which you want to implement monitoring and alerting.
   - Click on the cluster name to access its details page.
4. Set Up Amazon CloudWatch Metrics:
   - In the cluster details page, navigate to the `Monitoring` or `Metrics` section.
   - Enable CloudWatch metrics for the Neptune cluster by clicking `Enable` or `Configure`.
   - Select the desired metrics to monitor, such as CPU utilization, storage usage, or network throughput.
   - Choose the appropriate granularity and sampling intervals for the metrics.
   - Click `Save` or `Apply Changes` to enable CloudWatch metrics for the Neptune cluster.
5. Configure CloudWatch Alarms:
   - In the CloudWatch console, navigate to `Alarms` in the left-side menu.
   - Click `Create alarm` to configure alarms based on specific metric thresholds.
   - Select the desired metric to monitor and set the threshold values for triggering an alarm.
   - Define the actions to be taken when the alarm state changes, such as sending notifications or triggering automated actions.
   - Configure the alarm settings, including alarm name, description, and notification recipients.
   - Click `Create alarm` to save the alarm configuration.
6. Set Up Amazon EventBridge Rules:
   - In the Amazon EventBridge console, navigate to `Rules` in the left-side menu.
   - Click on `Create rule` to set up rules for specific events or log entries related to Neptune.
   - Define the event pattern or log filter to match the desired events.
   - Configure the target actions to be taken when the rule matches an event, such as sending notifications or invoking AWS Lambda functions.
   - Specify the rule settings, including rule name, description, and event source.
   - Click `Create` to save the rule configuration.
7. Review and Customize Metrics and Alarms:
   - Periodically review the metrics and alarms configured for your Neptune cluster.
   - Adjust the metric thresholds and alarm settings based on your performance and alerting requirements.
   - Consider adding more metrics or alarms as needed to monitor additional aspects of your Neptune environment.
8. Regularly Monitor and Respond to Alerts:
   - Continuously monitor the CloudWatch metrics and alarm states for your Neptune cluster.
   - Respond promptly to any alarms triggered by critical or abnormal conditions.
   - Investigate the root causes of the alerts and take appropriate actions to mitigate issues.
9. Utilize Additional Monitoring Tools:
   - Explore and leverage additional monitoring and observability tools available in the AWS ecosystem, such as Amazon CloudWatch Logs Insights, AWS X-Ray, or third-party monitoring solutions.
   - Configure these tools to gather insights and detect any performance or security issues in your Neptune environment.

## Expected Result

CloudWatch metrics, alarms, and EventBridge rules should be properly configured to provide comprehensive monitoring and alerting for the Neptune cluster.

## Remediation

### Using AWS Console

Follow the audit steps above to set up CloudWatch metrics, alarms, and EventBridge rules for your Neptune cluster.

## Default Value

Basic CloudWatch metrics are available for Neptune clusters, but alarms and EventBridge rules must be manually configured.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.1 Establish and Maintain an Audit Log Management Process | x    | x    | x    |
| v7               | 6.2 Activate audit logging                                 | x    | x    | x    |

## Profile

Level 1 | Manual
