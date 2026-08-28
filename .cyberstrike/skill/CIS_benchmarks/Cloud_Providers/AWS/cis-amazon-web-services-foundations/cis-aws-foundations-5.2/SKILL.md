---
name: cis-aws-foundations-5.2
description: "Ensure management console sign-in without MFA is monitored"
category: cis-monitoring
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, monitoring, cloudwatch, cloudtrail, metric-filters, alarms, mfa, console-signin]
cis_id: "5.2"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-4.1, cis-aws-foundations-4.2]
prerequisites: []
severity_boost: {}
---

# Ensure management console sign-in without MFA is monitored

## Description

Real-time monitoring of API calls can be achieved by directing CloudTrail Logs to CloudWatch Logs or an external Security Information and Event Management (SIEM) environment, and establishing corresponding metric filters and alarms.

It is recommended that a metric filter and alarm be established for console logins that are not protected by multi-factor authentication (MFA).

## Rationale

CloudWatch is an AWS native service that allows you to observe and monitor resources and applications. CloudTrail logs can also be sent to an external Security Information and Event Management (SIEM) environment for monitoring and alerting.

Monitoring for single-factor console logins will increase visibility into accounts that are not protected by MFA. These type of accounts are more susceptible to compromise and unauthorized access.

## Impact

N/A

## Audit Procedure

### Using AWS CLI

If you are using CloudTrail trails and CloudWatch, perform the following to ensure that there is at least one active multi-region CloudTrail trail with the prescribed metric filters and alarms configured:

1. Identify the log group name that is configured for use with the active multi-region CloudTrail trail:

- List all CloudTrail trails:

```bash
aws cloudtrail describe-trails
```

- Identify multi-region CloudTrail trails: Trails with `"IsMultiRegionTrail"` set to `true`
- Note the value associated with `"Name":<trail-name>`
- Note the `<trail-log-group-name>` within the value associated with `"CloudWatchLogsLogGroupArn"`
  - Example: `arn:aws:logs:<region>:<account-id>:log-group:<trail-log-group-name>:*`

- Ensure the identified multi-region CloudTrail trail is active:

```bash
aws cloudtrail get-trail-status --name <trail-name>
```

- Ensure `IsLogging` is set to `TRUE`

- Ensure the identified multi-region CloudTrail trail captures all management events:

```bash
aws cloudtrail get-event-selectors --trail-name <trail-name>
```

- Ensure there is at least one event selector for a trail with `IncludeManagementEvents` set to `true` and `ReadWriteType` set to `All`

2. Get a list of all associated metric filters for the `<trail-log-group-name>` captured in step 1:

```bash
aws logs describe-metric-filters --log-group-name <trail-log-group-name>
```

3. Ensure the output from the above command contains the following:

```
"filterPattern": "{ ($.eventName = "ConsoleLogin") && ($.additionalEventData.MFAUsed != "Yes") }"
```

Or, to reduce false positives in case Single Sign-On (SSO) is used in the organization:

```
"filterPattern": "{ ($.eventName = "ConsoleLogin") && ($.additionalEventData.MFAUsed != "Yes") && ($.userIdentity.type = "IAMUser") && ($.responseElements.ConsoleLogin = "Success") }"
```

4. Note the `<no-mfa-console-signin-metric>` value associated with the `filterPattern` from step 3.

5. Get a list of CloudWatch alarms, and filter on the `<no-mfa-console-signin-metric>` captured in step 4:

```bash
aws cloudwatch describe-alarms --query 'MetricAlarms[?MetricName== <no-mfa-console-signin-metric>]'
```

6. Note the `AlarmActions` value; this will provide the SNS topic ARN value.

7. Ensure there is at least one active subscriber to the SNS topic:

```bash
aws sns list-subscriptions-by-topic --topic-arn <sns-topic-arn>
```

- At least one subscription should have "SubscriptionArn" with a valid AWS ARN.
  - Example of valid "SubscriptionArn": `arn:aws:sns:<region>:<account-id>:<sns-topic-name>:<subscription-id>`

## Expected Result

A metric filter exists with the filter pattern matching console sign-in events without MFA, a CloudWatch alarm is configured for the metric, and the alarm has an active SNS topic with at least one subscriber.

## Remediation

### Using AWS CLI

If you are using CloudTrail trails and CloudWatch, perform the following steps to set up the metric filter, alarm, SNS topic, and subscription:

1. Create a metric filter based on the provided filter pattern that checks for AWS Management Console sign-ins without MFA and uses the `<trail-log-group-name>` taken from audit step 1:

```bash
aws logs put-metric-filter --log-group-name <trail-log-group-name> --filter-name `<no-mfa-console-signin-metric>` --metric-transformations metricName= `<no-mfa-console-signin-metric>`,metricNamespace='CISBenchmark',metricValue=1 --filter-pattern '{ ($.eventName = "ConsoleLogin") && ($.additionalEventData.MFAUsed != "Yes") }'
```

Or, to reduce false positives in case Single Sign-On (SSO) is used in the organization:

```bash
aws logs put-metric-filter --log-group-name <trail-log-group-name> --filter-name `<no-mfa-console-signin-metric>` --metric-transformations metricName= `<no-mfa-console-signin-metric>`,metricNamespace='CISBenchmark',metricValue=1 --filter-pattern '{ ($.eventName = "ConsoleLogin") && ($.additionalEventData.MFAUsed != "Yes") && ($.userIdentity.type = "IAMUser") && ($.responseElements.ConsoleLogin = "Success") }'
```

**Note**: You can choose your own `metricName` and `metricNamespace` strings. Using the same `metricNamespace` for all Foundations Benchmark metrics will group them together.

2. Create an SNS topic that the alarm will notify:

```bash
aws sns create-topic --name <sns-topic-name>
```

3. Create an SNS subscription for the topic created in step 2:

```bash
aws sns subscribe --topic-arn <sns-topic-arn> --protocol <sns-protocol> --notification-endpoint <sns-subscription-endpoints>
```

4. Create an alarm that is associated with the CloudWatch Logs metric filter created in step 1 and the SNS topic created in step 2:

```bash
aws cloudwatch put-metric-alarm --alarm-name `<no-mfa-console-signin-alarm>` --metric-name `<no-mfa-console-signin-metric>` --statistic Sum --period 300 --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold --evaluation-periods 1 --namespace 'CISBenchmark' --alarm-actions <sns-topic-arn>
```

## Default Value

By default, no CloudWatch metric filters or alarms exist for console sign-ins without MFA.

## References

1. https://docs.aws.amazon.com/AmazonCloudWatch/latest/DeveloperGuide/viewing_metrics_with_cloudwatch.html
2. CCE-79187-1
3. https://docs.aws.amazon.com/awscloudtrail/latest/userguide/receive-cloudtrail-log-files-from-multiple-regions.html
4. https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudwatch-alarms-for-cloudtrail.html
5. https://docs.aws.amazon.com/sns/latest/dg/SubscribeTopic.html

## CIS Controls

| Controls Version | Control                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs |      | x    | x    |
| v8               | 8.11 Conduct Audit Log Reviews  |      | x    | x    |
| v7               | 6.3 Enable Detailed Logging     |      | x    | x    |

## Profile

Level 1 | Manual
