---
name: cis-aws-database-4.9
description: "Ensure Database has Backup enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, dynamodb, backup, pitr, disaster-recovery]
cis_id: "4.9"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-4.8]
prerequisites: []
severity_boost: {}
---

# 4.9 Ensure Database has Backup enabled

## Description

Ensure your DynamoDB tables have backups enabled to protect against accidental data loss or corruption. This can be achieved in two ways: by enabling Point-in-Time Recovery (PITR), which provides continuous backups for up to 35 days, and by configuring on-demand backups that can be automated using the AWS Backup service.

## Rationale

Backups are essential for restoring data after accidental deletions, application errors or malicious events. Enabling both continuous and scheduled backups maximizes data resilience while meeting recovery point objectives (RPO) and compliance mandates.

## Impact

Without backups, data loss can be permanent which can lead to business disruption and potential regulatory penalties. Enabling backup provides assurance of data availability and accelerates recovery from incidents, supporting overall system reliability.

## Audit Procedure

### Using AWS Console

**1. Check if Point-in-Time Recovery (PITR) is enabled**

1.1 Log in to the AWS Management Console.
1.2 Navigate to DynamoDB in the AWS Services menu.

- Select "Tables" from the left sidebar.
  1.3 Click on the specific table name that you want to audit.
  1.4 Go to the "Backups" tab in the table's navigation bar.
  1.5 Under the "Point-in-time recovery (PITR)" section:
- Verify that "Status" is "On", which means PITR is enabled.
- Check the "Backup recovery period" value, this displays the configured retention period in days.
- Optionally, review the Earliest restore point and Latest restore point timestamps to confirm the exact window for recovery.

### Using AWS CLI

**2. Check if automated backups are enabled via AWS Backup Service**

2.1 Check if Table is Assigned to a Backup Plan

- List backup plans:

```bash
aws backup list-backup-plans --query "BackupPlansList[].BackupPlanName" --output table
```

- For each backup plan, list all backup selections (resource assignments):

```bash
aws backup list-backup-selections --backup-plan-id <your-backup-plan-id> --query "BackupSelections[].SelectionId" --output text
```

- For each selection, list assigned resources and search for your table:

```bash
aws backup get-backup-selection --backup-plan-id <your-backup-plan-id> --selection-id <selection-id> --query "BackupSelection.Resources" --output text
```

- If your table ARN appears in any selection, it is protected by the backup plan.

2.2 Verify Backup Plan Configuration

```bash
aws backup get-backup-plan --backup-plan-id <your-backup-plan-id>
```

Look for the "Lifecycle" fields in each backup rule:

- "DeleteAfterDays" is the retention period.
- "ScheduleExpression" sets the backup schedule (cron format).
- "BackupVaultName" is the name of the vault (where backups are stored).

**Summary:**

1. Confirm PITR is enabled for the table and note its retention period (up to 35 days).
2. Confirm if AWS Backup plans exist and are actively creating recovery points for your DynamoDB tables.

## Expected Result

PITR is enabled on all critical DynamoDB tables and AWS Backup plans are configured with appropriate retention periods and schedules.

## Remediation

### Using AWS CLI

**1. Create Backup Plan with 2 Rules (Continuous and Scheduled Snapshots)**

```bash
aws backup create-backup-plan --backup-plan '{
  "BackupPlanName": "<BackupPlanName>",
  "Rules": [
    {
      "RuleName": "Continuous-PITR",
      "TargetBackupVaultName": "Default",
      "ScheduleExpression": "cron(0 * * * ? *)",
      "StartWindowMinutes": 60,
      "CompletionWindowMinutes": 180,
      "Lifecycle": { "DeleteAfterDays": 35 },
      "RecoveryPointTags": { "BackupType": "Continuous" },
      "EnableContinuousBackup": true
    },
    {
      "RuleName": "Scheduled-OnDemand-Snapshots",
      "TargetBackupVaultName": "Default",
      "ScheduleExpression": "cron(0 3 ? * SUN *)",
      "StartWindowMinutes": 120,
      "CompletionWindowMinutes": 360,
      "Lifecycle": { "DeleteAfterDays": 90 },
      "RecoveryPointTags": { "BackupType": "OnDemand" }
    }
  ]
}'
```

- Replace "BackupPlanName" with your backup plan name
- Replace "Default" with your actual backup vault name if different
- Update the "ScheduleExpression", "StartWindowMinutes" based on your unique backup schedule. Note, this schedule is ignored for PITR as that is continuous backup.
- Replace "35" with your retention time for PITR if shorter
- Replace "90" with your retention time for Snapshots if different

This command outputs the BackupPlanId necessary for the next step.

**2. Assign DynamoDB Table to the Backup Plan**

Replace <BackupPlanId> with the ID from Step 1 and <TableArn> with your DynamoDB table ARN.

```bash
aws backup create-backup-selection \
  --backup-plan-id <BackupPlanId> \
  --backup-selection '{
    "SelectionName": "DynamoDBTableSelection",
    "IamRoleArn": "arn:aws:iam::<account-id>:role/AWSBackupServiceRolePolicyForBackup",
    "Resources": ["<TableArn>"]
  }'
```

- Make sure the IAM role has the necessary AWS Backup permissions.

These commands create a centralized backup plan with continuous and scheduled snapshot backups, then assign your DynamoDB table as a resource for backup.

## Default Value

By default, PITR is not enabled on DynamoDB tables and no AWS Backup plans are configured.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------ | ---- | ---- | ---- |
| v8               | 11.2 Perform Automated Backups | x    | x    | x    |

## Profile

Level 1 | Manual
