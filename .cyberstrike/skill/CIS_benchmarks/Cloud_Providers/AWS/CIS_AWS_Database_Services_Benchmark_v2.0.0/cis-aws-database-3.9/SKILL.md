---
name: cis-aws-database-3.9
description: "Ensure Monitoring and Logging is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, rds, monitoring, logging, cloudwatch, audit]
cis_id: "3.9"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-3.11]
prerequisites: []
severity_boost: {}
---

# 3.9 Ensure Monitoring and Logging is Enabled (Manual)

## Description

This control ensures that monitoring and logging are enabled for Amazon RDS instances to detect, investigate, and respond to security events and operational issues.

## Rationale

Monitoring and logging provide visibility into database activity, enabling detection of unauthorized access, performance issues, and security incidents.

## Impact

If the individual is not monitoring and logging their activity it allows the attacker to attack the system and extract or destroy data.

## Audit Procedure

### Using AWS Console

1. Sign into the AWS Management Console
   - Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon RDS Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/rds/.

3. Select the RDS Instance
   - Choose the Amazon RDS instance you want to enable monitoring and logging.
   - Click on the instance name to access its details page.
   - In the instance details page, navigate to the `Configuration` or `Monitoring & Logs` section.

4. Enable Enhanced Monitoring
   - Under the `Monitoring` section.
   - Click on the `Modify` button or `Edit` option to enable enhanced monitoring.
   - Choose the desired monitoring granularity (1-minute or 5-minute intervals) and the retention period for the monitoring data.
   - Click `Continue` or `Save` to apply the changes.

5. Enable Enhanced Logging
   - Under the `Logs` or `Monitoring & Logs` section.
   - Click on the `Modify` button or `Edit` option to enable enhanced logging.
   - Choose the desired log types to enable, such as general, error, slow query, or audit logs.
   - Configure the log file retention period based on your needs.
   - Select the destination for the logs, such as Amazon CloudWatch Logs or an Amazon S3 bucket.
   - Configure the log format and other settings if applicable.
   - Click `Continue` or `Save` to apply the changes.

6. Configure CloudWatch Alarms (Optional)
   - Click `Alarms` in the Amazon RDS console menu.
   - Click `Create alarm` to create a CloudWatch alarm to monitor specific metrics or log events.
   - Configure the alarm threshold, actions to take when the threshold is breached, and notification settings.
   - Click `Create` to create the CloudWatch alarm.

7. Monitor and Analyze the Metrics and Logs
   - Monitor the metrics and logs in the Amazon RDS console or by accessing CloudWatch or the configured log destination.
   - Use the metrics and logs to gain insights into your RDS instance's performance, behavior, and issues.
   - Analyze the metrics and logs to identify areas for optimization, troubleshoot problems, or detect anomalies.

8. Set Up Automated Actions (Optional)
   - In the Amazon RDS console, click on `Event subscriptions` in the left-side menu.
   - Click `Create event subscription` to set up automated actions based on specific events or log entries.
   - Configure the event pattern, target actions, and notification settings.
   - Click `Create` to create the event subscription.

9. Monitor and Respond to Alerts
   - Monitor the CloudWatch alarms and event notifications for any alerts or triggers based on the configured thresholds.
   - Respond to alerts promptly by investigating and resolving the underlying issues or taking appropriate actions.

## Expected Result

Enhanced Monitoring should be enabled, and appropriate log types (general, error, slow query, audit) should be configured and published to CloudWatch Logs or S3.

## Remediation

### Using AWS Console

Follow the audit steps above to enable Enhanced Monitoring and configure logging. Set up CloudWatch alarms for critical metrics and event subscriptions for automated alerting.

## Default Value

Enhanced Monitoring is disabled by default. Basic monitoring with 1-minute CloudWatch metrics is available by default. Database engine logs must be explicitly enabled and published.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8 Audit Log Management                               |      |      |      |
| v7               | 6 Maintenance, Monitoring and Analysis of Audit Logs |      |      |      |

## Profile

Level 1 | Manual
