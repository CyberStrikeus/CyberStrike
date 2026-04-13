---
name: cis-aws-database-10.6
description: "Ensure Audit Logging is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, timestream, time-series, audit-logging, cloudtrail]
cis_id: "10.6"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-10.5, cis-aws-database-10.7, cis-aws-database-10.8]
prerequisites: []
severity_boost: {}
---

# 10.6 Ensure Audit Logging is Enabled (Manual)

## Description
Enable AWS CloudTrail to capture and log API calls and activities related to Amazon Timestream. Configure CloudTrail to store the logs in a secure location and regularly review the logs for any unauthorized or suspicious activities.

## Rationale
This captures and saves logs of activities that took place in the database.

## Impact
This reduces risks of any fraud since worker activity is being monitored and tracked.

## Audit Procedure

### Using AWS Console
1. Understand Audit Logging in Timestream:
   - Familiarize yourself with audit logging and its importance in monitoring and tracking activities in Timestream. Understand that audit logs capture API calls and events related to Timestream actions and resources.
2. Enable AWS CloudTrail:
   - Access the AWS Management Console and navigate to the AWS CloudTrail service. Create a new CloudTrail trail or use an existing one to capture Timestream audit logs. Configure the trail to include Timestream as a data source for logging.
3. Configure CloudTrail Logging Options:
   - Specify the desired settings for the CloudTrail trail, such as the S3 bucket to store the audit logs and the log file encryption options. Enable logging of management and data events related to Timestream. Configure the trail to capture the necessary information for your audit and compliance requirements.
4. Set Up CloudTrail Notifications and Alerts:
   - Configure CloudTrail to send notifications or trigger actions based on specific events or conditions. Set up CloudWatch Alarms to monitor and receive notifications for critical Timestream audit events. Define the appropriate alert thresholds and actions to respond to specific events.
5. Access and Review Audit Logs:
   - Access the configured S3 bucket where the Timestream audit logs are stored. Retrieve and review the logs using AWS Management Console, AWS CLI, or any preferred log analysis tools. Analyze the audit logs to track Timestream activities, detect anomalies, and investigate security incidents.
6. Retention and Compliance Considerations:
   - Determine the appropriate retention period for your Timestream audit logs based on compliance and regulatory requirements. Implement appropriate data lifecycle management policies for your audit logs stored in the S3 bucket. Ensure compliance with data protection and privacy regulations applicable to your organization.
7. Regularly Review and Monitor Audit Logs:
   - Establish a regular review process for your Timestream audit logs. Monitor the logs for unauthorized access attempts, unusual activities, or policy violations. Respond promptly to any identified security incidents or anomalies.

## Expected Result
AWS CloudTrail should be enabled and configured to capture all Timestream API calls and events, with logs stored securely in S3 with appropriate retention policies.

## Remediation

### Using AWS Console
Follow the audit steps above to enable and configure AWS CloudTrail for Amazon Timestream audit logging.

## Default Value
CloudTrail can capture Timestream events but must be explicitly configured with a trail that includes Timestream as a data source.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.1 Establish and Maintain an Audit Log Management Process | x | x | x |
| v7 | 6.2 Activate audit logging | x | x | x |

## Profile
Level 1 | Manual
