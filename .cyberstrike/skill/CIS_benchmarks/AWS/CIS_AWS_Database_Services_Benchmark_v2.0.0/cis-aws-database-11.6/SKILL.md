---
name: cis-aws-database-11.6
description: "Ensure Monitoring and Logging is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, qldb, ledger, monitoring, logging, cloudwatch, cloudtrail]
cis_id: "11.6"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-11.1, cis-aws-database-11.5, cis-aws-database-11.7]
prerequisites: []
severity_boost: {}
---

# 11.6 Ensure Monitoring and Logging is Enabled (Manual)

## Description
Enable QLDB's built-in logging to capture important system events and database activity. Monitor the logs for any suspicious activities or errors. Leverage Amazon CloudWatch to collect and analyze logs, set up alarms, and receive notifications for potential security incidents.

## Rationale
This helps the individual know what is being logged within the activity and determine what next step they should take to address it.

## Impact
Monitoring and logging provides visibility into QLDB operations, enabling detection of unauthorized access, performance issues, and security incidents.

## Audit Procedure

### Using AWS Console
1. Enable AWS CloudTrail:
   - Sign in to the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.
   - Open the AWS CloudTrail console.
   - Create a new trail or select an existing trail.
   - Configure the trail to capture QLDB API calls and relevant events.
   - Specify the Amazon S3 bucket where the CloudTrail logs will be stored.
   - Enable the trail to start capturing QLDB events.
2. Enable Amazon CloudWatch Logs:
   - Open the Amazon CloudWatch console.
   - Create a new log group or select an existing log group.
   - Configure the log group to receive QLDB logs from CloudTrail.
   - Define the log retention period to retain the logs for the desired duration.
   - Enable CloudWatch Logs to start receiving and storing QLDB logs.
3. Configure Log Metric Filters:
   - In the CloudWatch console, go to the log group that contains the QLDB logs.
   - Define log metric filters to extract specific information or patterns from the logs.
   - Create metric filters based on your monitoring and alerting requirements.
   - Specify the target metric and define the filter patterns to match the desired log events.
4. Create CloudWatch Dashboards and Alarms:
   - Create CloudWatch dashboards to visualize and monitor important QLDB metrics.
   - Customize the dashboard widgets to display relevant log metrics, such as API calls or errors.
   - Set up CloudWatch alarms to trigger notifications or automated actions based on specific thresholds or conditions.
   - Configure alarm actions, such as sending email notifications or invoking AWS Lambda functions, to respond to critical events.
5. Enable EventBridge Integration (Optional):
   - Open the Amazon EventBridge console.
   - Create a new rule or select an existing rule.
   - Configure the rule to match specific QLDB events or patterns.
   - Define targets for the rule, such as invoking Lambda functions or sending notifications to other AWS services.
6. Monitor and Analyze Logs and Metrics:
   - Regularly review the CloudWatch logs and metrics for QLDB.
   - Monitor key metrics and performance indicators to identify any issues or anomalies.
   - Use CloudWatch Logs Insights to query and analyze log data for troubleshooting.
7. Integrate with AWS Monitoring and Alerting Tools:
   - Leverage other AWS monitoring and alerting services like AWS X-Ray or AWS ServiceLens to gain deeper insights into QLDB performance and behavior.
   - Configure additional alerts or notifications using AWS services like Amazon SNS or AWS Chatbot.
8. Regularly Review and Update Logging and Monitoring Configuration:
   - Periodically review and update your CloudTrail, CloudWatch, and EventBridge configurations to align with changes in your monitoring requirements.
   - Stay informed about AWS security best practices and new features.

## Expected Result
CloudTrail, CloudWatch Logs, metric filters, dashboards, and alarms should be properly configured to provide comprehensive monitoring and logging for QLDB.

## Remediation

### Using AWS Console
Follow the audit steps above to enable and configure monitoring and logging for your Amazon QLDB environment.

## Default Value
QLDB API calls can be captured by CloudTrail. CloudWatch Logs integration and alarms must be manually configured.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.1 Establish and Maintain an Audit Log Management Process | x | x | x |
| v7 | 6.2 Activate audit logging | x | x | x |

## Profile
Level 1 | Manual
