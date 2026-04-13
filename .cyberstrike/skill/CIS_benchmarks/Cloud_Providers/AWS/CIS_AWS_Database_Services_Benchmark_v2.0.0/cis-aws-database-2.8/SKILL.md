---
name: cis-aws-database-2.8
description: "Ensure Automatic Backups and Retention Policies are configured"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, aurora, backup, retention, disaster-recovery, data-protection]
cis_id: "2.8"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-2.11]
prerequisites: []
severity_boost: {}
---

# 2.8 Ensure Automatic Backups and Retention Policies are configured (Manual)

## Description

Backups help protect your data from accidental loss or database failure. With Amazon Aurora, you can turn on automatic backups and specify a retention period. The backups include a daily snapshot of the entire DB instance and transaction logs.

## Rationale

The individual logs into their account and chooses their database once selected they can modify the backup settings. To have the database being backed up automatically the individual is encouraged to select from 1 to 35 days. This ensures that the file is being saved automatically and can prevent it from accidental loss. This ensures that the individual can restore their files quickly in the event of a data loss.

## Impact

It would result in having the files protected and being able to retrieve those files in the event of an accidental loss.

## Audit Procedure

### Using AWS Console

1. **Sign in to AWS Management Console**
   - If you do not already have an AWS account, you will need to create one at https://aws.amazon.com.

2. **Navigate to Amazon RDS Dashboard**
   - Navigate to the RDS service once logged in to the AWS Management Console.
   - You can find this under the `Database` category.

3. **Choose your Aurora DB instance**
   - In the RDS Dashboard, click on `Databases`.
   - Then click on the name of your Aurora DB instance.

4. **Check or modify the backup settings**
   - In the `Details` section, find the `Backup` section.
   - Here, you can see if automatic backups are enabled (the `Backup retention period` is more than 0 days) and when the backup window is.
     - To modify these settings, click `Modify`.
     - In the `Backup` section of the `Modify DB instance` screen, you can change the `Backup retention period` and the `Backup window`.
     - The retention period can be between 1 and 35 days. To disable automatic backups, set the retention period to 0 days.

5. **Apply the changes**
   - Scroll to the bottom and choose when to apply the changes. You can apply them immediately or schedule them for the next maintenance window.
   - Then, click `Continue` and `Modify DB Instance`.

## Expected Result

Automatic backups should be enabled with a `Backup retention period` greater than 0 days. The retention period should align with organizational data retention and recovery requirements (recommended: 7-35 days).

## Remediation

This is important because it would allow the user to automatically save their files and instantly have access to their files when needed.

Follow the audit procedure steps above to configure automatic backups and set an appropriate retention period.

## Default Value

Amazon Aurora automatically enables backups with a default retention period of 1 day.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 11 Data Recovery - Establish and maintain data recovery practices sufficient to restore in-scope enterprise assets to a pre-incident and trusted state. |      |      |      |
| v7               | 10 Data Recovery Capabilities - Data Recovery Capabilities                                                                                              |      |      |      |

## Profile

Level 1 | Manual
