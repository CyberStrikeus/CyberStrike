---
name: cis-aws-storage-2.13
description: "Ensure creating an SNS subscription"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, sns, alerting, notification, monitoring, incident-response]
cis_id: "2.13"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-2.12]
prerequisites: [cis-aws-storage-2.12]
severity_boost: {}
---

# CIS Control 2.13: Ensure creating an SNS subscription (Manual)

## Profile Applicability

- **Level 2**

## Description

SNS (Simple Notification Service) subscriptions enable real-time alerts and notifications for AWS CloudWatch alarms and events, ensuring administrators are immediately informed of critical issues with EC2 instances and EBS volumes.

## Rationale

Creating SNS subscriptions is essential for timely incident response and proactive monitoring. By receiving immediate notifications about CloudWatch alarms, administrators can quickly address performance issues, security events, or resource failures before they impact operations.

## Impact

Without SNS subscriptions, CloudWatch alarms may go unnoticed, leading to delayed incident response, prolonged downtime, and potential data loss. Real-time notifications ensure that critical issues are addressed promptly, minimizing operational disruptions and maintaining service availability.

## Audit Procedure

### Via AWS Management Console

1. Navigate to SNS → Subscriptions
2. Verify subscriptions exist for critical CloudWatch alarms
3. Confirm subscription endpoints (email, SMS, Lambda) are active
4. Test notification delivery

### Via AWS CLI

\`\`\`bash

# List SNS topics

aws sns list-topics

# List subscriptions

aws sns list-subscriptions

# Get topic attributes

aws sns get-topic-attributes --topic-arn <TOPIC_ARN>

# List subscriptions for specific topic

aws sns list-subscriptions-by-topic --topic-arn <TOPIC_ARN>
\`\`\`

## Expected Result

- SNS topics exist for critical alarm categories
- Subscriptions are configured for appropriate notification channels
- Subscription endpoints are confirmed and active
- Test notifications are successfully delivered

## Remediation

### Via AWS Management Console

1. Navigate to SNS → Create Topic
2. Provide topic name and display name
3. Create subscription to the topic
4. Choose protocol (Email, SMS, HTTPS, Lambda, SQS)
5. Enter endpoint details
6. Confirm subscription
7. Link topic to CloudWatch alarms

### Via AWS CLI

\`\`\`bash

# Create SNS topic

aws sns create-topic --name CloudWatchAlerts

# Create email subscription

aws sns subscribe \
 --topic-arn arn:aws:sns:region:account:CloudWatchAlerts \
 --protocol email \
 --notification-endpoint admin@example.com

# Confirm subscription (check email for confirmation link)

# Associate CloudWatch alarm with SNS topic

aws cloudwatch put-metric-alarm \
 --alarm-name HighCPUUtilization \
 --alarm-actions arn:aws:sns:region:account:CloudWatchAlerts \
 --metric-name CPUUtilization \
 --namespace AWS/EC2 \
 --statistic Average \
 --period 300 \
 --threshold 80 \
 --comparison-operator GreaterThanThreshold
\`\`\`

## Default Value

No SNS topics or subscriptions are created by default.

## References

1. [Amazon SNS](https://docs.aws.amazon.com/sns/latest/dg/welcome.html)
2. [CloudWatch Alarms with SNS](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html)

## CIS Controls

Not explicitly mapped in the provided documentation.

## Notes

- This is a **manual** control requiring SNS configuration verification
- Configure multiple notification channels for redundancy
- Use SNS message filtering to reduce notification noise
- Regularly test SNS subscriptions to ensure delivery
- Consider integrating with incident management systems (PagerDuty, OpsGenie)
