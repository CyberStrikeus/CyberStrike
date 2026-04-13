---
name: cis-aws-storage-6.12
description: "Ensure CloudWatch Metrics for AWS EDR"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, edr, cloudwatch, monitoring, metrics, logging, alerting]
cis_id: "6.12"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-6.9, cis-aws-storage-6.13]
prerequisites: []
severity_boost: {}
---

# CIS 6.12: Ensure CloudWatch Metrics for AWS EDR (Manual)

## Profile Applicability

- **Level:** 2

## Description

Set up and monitor AWS CloudWatch metrics for Endpoint Detection and Response (EDR) to track and analyze the performance and security of your AWS environment. This involves configuring CloudWatch to collect detailed logs and metrics on EDR activities, such as threat detections, response actions, and system health. Regularly review these metrics to identify trends, anomalies, and potential security issues, enabling proactive management and timely responses to ensure the effectiveness of your EDR solution.

## Rationale

Implementing AWS CloudWatch metrics for Endpoint Detection and Response (EDR) is essential for maintaining a secure and efficient AWS environment. By collecting detailed logs and metrics on EDR activities, you gain valuable insights into the performance and health of your security measures. Regular review of these metrics allows for the early detection of trends, anomalies, and potential security threats, enabling proactive management and swift responses to maintain the integrity and effectiveness of your EDR solution. This continuous monitoring ensures that your security posture remains robust and adaptive to evolving threats.

## Impact

CloudWatch monitoring provides:
- Visibility into EDR performance
- Early detection of issues
- Trend analysis capabilities
- Anomaly detection
- Proactive management capabilities
- Audit trail for compliance

Requirements:
- CloudWatch log group configuration
- Metric collection setup
- Alarm configuration
- Dashboard creation
- Log insights queries
- Event rule configuration

## Audit Procedure

### Via AWS Console

1. **Sign in to the AWS Management Console:**
   - Open the [AWS Management Console](https://console.aws.amazon.com) and sign in with your credentials.

2. **Navigate to CloudWatch:**
   - In the AWS Management Console, navigate to the CloudWatch service.

3. **Create a CloudWatch Log Group:**
   - Select Logs from the navigation pane.
   - Click on Create log group.
   - Enter a name for the log group and click Create.

4. **Configure AWS EDR to Send Logs to CloudWatch:**
   - Go to the AWS EDR (Elastic Disaster Recovery) console.
   - In the AWS EDR console, configure your settings to send logs and metrics to the CloudWatch log group you created.

5. **Set Up CloudWatch Alarms:**
   - In the CloudWatch console, select Alarms from the navigation pane.
   - Click on Create Alarm.
   - Select the metric you want to monitor from the list of AWS EDR metrics.
   - Configure the conditions for the alarm (e.g., threshold, period, etc.).
   - Set the actions to take when the alarm state is triggered (e.g., send a notification).
   - Review and create the alarm.

6. **Create CloudWatch Dashboards:**
   - In the CloudWatch console, select Dashboards from the navigation pane.
   - Click on Create dashboard.
   - Enter a name for your dashboard and click Create.
   - Add widgets to the dashboard by selecting the relevant AWS EDR metrics.
   - Customize the widgets to display the data in a meaningful way (e.g., graphs, numbers).

7. **Enable CloudWatch Logs Insights:**
   - In the CloudWatch console, select Logs Insights from the navigation pane.
   - Choose the log group you created for AWS EDR.
   - Use CloudWatch Logs Insights queries to analyze the log data and extract meaningful insights.

8. **Set Up CloudWatch Events:**
   - In the CloudWatch console, select Events from the navigation pane.
   - Click on Create rule.
   - Define the event source and the specific events you want to capture (e.g., changes in EDR status).
   - Set the target for the event (e.g., send a notification, invoke a Lambda function).
   - Configure the rule and click Create rule.

## Expected Result

- CloudWatch log group created with appropriate name
- AWS EDR configured to send logs to CloudWatch
- CloudWatch alarms configured for key EDR metrics:
  - Threat detection alerts
  - Response action monitoring
  - System health metrics
  - Replication status
  - Backup completion status
- Alarm thresholds configured appropriately
- Alarm actions configured (notifications, Lambda, etc.)
- CloudWatch dashboards created showing:
  - EDR activity metrics
  - Threat detection trends
  - System health status
  - Performance metrics
- Dashboard widgets customized for clarity
- CloudWatch Logs Insights configured
- Log queries available for analysis
- CloudWatch Events rules created for:
  - EDR status changes
  - Critical alerts
  - Configuration changes
- Event targets configured (SNS, Lambda, etc.)

## Remediation

### Via AWS Console

1. **Create Log Group:**
   - Sign in to AWS Management Console
   - Navigate to CloudWatch service
   - Select Logs > Create log group
   - Enter meaningful name (e.g., "aws-edr-logs")
   - Create log group

2. **Configure EDR Logging:**
   - Access AWS EDR console
   - Configure settings to send logs to CloudWatch
   - Verify log delivery

3. **Set Up Alarms:**
   - In CloudWatch, select Alarms > Create Alarm
   - Select EDR metrics to monitor:
     - Replication lag
     - Backup failures
     - Recovery job status
     - Threat detections
   - Configure thresholds and periods
   - Set actions (SNS notifications, Lambda, etc.)
   - Create alarms

4. **Create Dashboards:**
   - Select Dashboards > Create dashboard
   - Name dashboard (e.g., "EDR-Monitoring")
   - Add widgets for key metrics:
     - Replication status
     - Backup completion rates
     - Recovery instance health
     - Alert trends
   - Customize visualization
   - Save dashboard

5. **Enable Logs Insights:**
   - Select Logs Insights
   - Choose EDR log group
   - Create useful queries for common analysis
   - Save queries for future use

6. **Configure Events:**
   - Select Events > Create rule
   - Define event patterns for:
     - EDR status changes
     - Failed backups
     - Failed replication
     - Security alerts
   - Configure targets (SNS, Lambda, etc.)
   - Create and enable rules

7. **Test and Verify:**
   - Generate test events
   - Verify alarms trigger correctly
   - Check dashboard displays data
   - Validate log ingestion
   - Test event rules

## Default Value

By default, CloudWatch metrics for AWS EDR are not configured. Organizations must manually set up log groups, metrics, alarms, dashboards, and event rules.

## References

- [AWS CloudWatch Monitoring](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html)
- [AWS Elastic Disaster Recovery Monitoring](https://docs.aws.amazon.com/drs/latest/userguide/monitoring.html)

## CIS Controls

This control supports monitoring and logging best practices but does not directly map to specific CIS Controls v7/v8 items. It enables compliance with multiple controls related to logging, monitoring, and incident response.

## Profile

- Level 2
