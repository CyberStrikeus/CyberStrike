---
name: cis-aws-database-2.5
description: "Ensure Database Audit Logging is Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, aurora, logging, audit, cloudtrail, activity-streams]
cis_id: "2.5"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-2.4]
prerequisites: []
severity_boost: {}
---

# 2.5 Ensure Database Audit Logging is Enabled (Manual)

## Description

Amazon Aurora provides advanced auditing capabilities through AWS CloudTrail and Amazon RDS Database Activity Streams. Here is a step-by-step guide on how to enable and use these features:

## Rationale

Allows individuals to access and retrieve their old logs, log their new events, and store their log.

## Impact

Without audit logging enabled, it becomes difficult to track database access, detect unauthorized activities, and meet compliance requirements.

## Audit Procedure

### Using AWS Console

**Enabling logging through AWS CloudTrail:**

1. **Sign in to AWS Management Console**
   - If you do not already have an AWS account, you will need to create one at https://aws.amazon.com.

2. **Navigate to CloudTrail Dashboard**
   - Navigate to the CloudTrail service.
   - You can find this under the `Management & Governance` category.

3. **Create a new trail**
   - In the CloudTrail Dashboard, click on `Create trail`.
   - Provide a name for the trail, and specify the S3 bucket where you want the logs to be stored.

4. **Configure trail settings**
   - Choose the settings that meet your requirements. For instance, you can log events for all regions, or you can log management events, data events, or both.

5. **Create the trail**
   - After specifying the trail settings, click `Create`.

**Enabling logging through Amazon Database Activity Streams:**

1. **Navigate to Amazon RDS Dashboard**
   - In the AWS Management Console, navigate to the RDS service.
   - You can find this under the `Database` category.

2. **Choose your Aurora DB instance**
   - In the RDS Dashboard, click on `Databases`, and then click on the name of your Aurora DB instance.

3. **Enable Database Activity Streams**
   - In the `Connectivity & Security` tab, find the `Database Activity Streams` section. Click `Create stream`.
   - In the `Create Stream` panel, choose the settings that meet your requirements and click `Create`.

**Note**: Enabling Database Activity Streams can impact the performance of your DB instance, so you should test this feature in a non-production environment before enabling it in production.

4. **View the Database Activity Stream**
   - You can view the Database Activity Stream using Amazon Kinesis Data Streams.
   - In the Kinesis Data Streams dashboard, click on the stream's name and then click `View data`.

## Expected Result

- A CloudTrail trail should be configured to log Aurora/RDS API events.
- Database Activity Streams should be enabled for Aurora clusters requiring detailed database-level audit logging.

## Remediation

Follow the audit procedure steps above to enable CloudTrail logging and/or Database Activity Streams for Aurora clusters.

## Default Value

CloudTrail logs management events by default, but a trail must be created to store and retain logs. Database Activity Streams are not enabled by default.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 8.1 Establish and Maintain an Audit Log Management Process - Establish and maintain an audit log management process that defines the enterprise's logging requirements. At a minimum, address the collection, review, and retention of audit logs for enterprise assets. Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard. | x | x | x |
| v7 | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices. | x | x | x |

## Profile

Level 1 | Manual
