---
name: cis-aws-database-4.7
description: "Ensure Monitor and Audit Activity is enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, dynamodb, monitoring, cloudtrail, cloudwatch, audit]
cis_id: "4.7"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-4.6]
prerequisites: []
severity_boost: {}
---

# 4.7 Ensure Monitor and Audit Activity is enabled

## Description

Regular monitoring and auditing of activity in Amazon DynamoDB help ensure your database's security, performance, and compliance.

## Rationale

This keeps track and ensures who has recently modified a document and monitors all activity within the database. This information allows the individual to use the details provided for auditing purposes and to address any compliance requirements.

## Impact

N/A

## Audit Procedure

### Using AWS Console

1. Enable CloudTrail Logging for DynamoDB
   - Sign in to the AWS Management Console and open the CloudTrail console at https://console.aws.amazon.com/cloudtrail/.
   - Choose `Trails` from the left-side menu.
   - Click `Create trail` or select an existing trail.
   - Specify a trail name, choose an S3 bucket for storing logs, and configure other trail settings.
   - Under `Data events`, select the checkbox for `DynamoDB` to enable logging of DynamoDB data events.
   - Click `Create trail` or `Save changes` to save the CloudTrail configuration.

2. Enable DynamoDB Streams
   - Sign in to the AWS Management Console and open the DynamoDB console at https://console.aws.amazon.com/dynamodb/.
   - Select the DynamoDB table you want to monitor.
   - Click on the `Overview` tab.
   - Under the `DynamoDB Streams` section, click `Manage stream`.
   - Enable DynamoDB Streams with the desired view type (e.g., `New and old images`).
   - Click `Enable`.

3. Configure Amazon CloudWatch Alarms
   - Sign in to the AWS Management Console and open the CloudWatch console at https://console.aws.amazon.com/cloudwatch/.
   - In the left-side menu, click on `Alarms`.
   - Click `Create alarm`.
   - Select a DynamoDB metric to monitor (e.g., Read or Write capacity units).
   - Configure the threshold, conditions, and actions for the alarm.
   - Choose the actions to take when the alarm state is triggered (e.g., send notifications, auto-scaling actions, etc.).
   - Click `Create alarm` to save the configuration.

4. Analyze and Review Logs and Metrics
   - Sign in to the AWS Management Console and open the CloudWatch console at https://console.aws.amazon.com/cloudwatch/.
   - In the left-side menu, click `Logs` to access CloudWatch Logs.
   - Select the appropriate log group for DynamoDB (e.g., `/aws/dynamodb/TableName`).
   - Review the logs to monitor activities, errors, and any unusual behavior.
   - Navigate to the CloudWatch console and click `Metrics` in the left-side menu.
   - Select the DynamoDB namespace and the desired metrics (e.g., ConsumedReadCapacityUnits, ConsumedWriteCapacityUnits).
   - Analyze the metrics to identify trends, capacity needs, and potential issues.

5. Enable AWS Config for DynamoDB
   - Sign in to the AWS Management Console and open the AWS Config console at https://console.aws.amazon.com/config/.
   - Click on `Rules` in the left-side menu.
   - Click `Add rule`.
   - Configure a rule for DynamoDB compliance checks, such as checking for unencrypted tables or insecure IAM policies.
   - Customize the rule settings and scope based on your requirements.
   - Click `Save` to create the AWS Config rule.

## Expected Result

CloudTrail logging is enabled for DynamoDB data events, DynamoDB Streams are enabled, CloudWatch alarms are configured, and AWS Config rules are in place for compliance monitoring.

## Remediation

### Using AWS Console

Follow the same steps as the audit procedure to enable monitoring and auditing for DynamoDB.

## Default Value

By default, CloudTrail logs management events but not DynamoDB data events. DynamoDB Streams are disabled by default.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.1 Establish and Maintain an Audit Log Management Process | x    | x    | x    |
| v7               | 6.2 Activate audit logging                                 | x    | x    | x    |

## Profile

Level 1 | Manual
