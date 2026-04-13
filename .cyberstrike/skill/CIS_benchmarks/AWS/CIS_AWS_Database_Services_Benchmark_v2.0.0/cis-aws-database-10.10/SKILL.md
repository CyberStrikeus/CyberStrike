---
name: cis-aws-database-10.10
description: "Ensure Database has automated Backups enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, timestream, time-series, backup, aws-backup, recovery]
cis_id: "10.10"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-10.8, cis-aws-database-10.9]
prerequisites: []
severity_boost: {}
---

# 10.10 Ensure Database has automated Backups enabled (Manual)

## Description
Ensure that Amazon Timestream tables have automated backups enabled through AWS Backup with a defined backup schedule and retention policy. AWS Backup provides scheduled, automated backup functionality for Timestream tables, creating regular point-in-time snapshots that are retained according to a configurable lifecycle policy.

## Rationale
Amazon Timestream stores critical time-series data that is often mission-critical for monitoring, analytics, and operational intelligence. Automated backups through AWS Backup ensure that Timestream tables are continuously protected without requiring manual intervention, and can be rapidly restored in the event of accidental deletion, data corruption, misconfiguration, or application errors.

## Impact
Enabling automated backups for Timestream ensures that time-series data is regularly captured in durable backups and recoverable to any point within the configured retention window, providing strong protection against accidental loss and data corruption.

## Audit Procedure

### Using AWS CLI
Important Note: Amazon Timestream does not have a native automated backup feature built into the service. Instead, backups are managed through AWS Backup, which provides scheduled, on-demand, and lifecycle-managed backup functionality for Timestream tables.

Check if automated backups are enabled via AWS Backup Service:

1. Check if Timestream Database is Assigned to a Backup Plan:

List backup plans:

```bash
aws backup list-backup-plans --query "BackupPlansList[].BackupPlanName" --output table
```

For each backup plan, list all backup selections (resource assignments):

```bash
aws backup list-backup-selections --backup-plan-id <your-backup-plan-id> --query "BackupSelections[].SelectionId" --output text
```

For each selection, list assigned resources and search for your database:

```bash
aws backup get-backup-selection --backup-plan-id <your-backup-plan-id> --selection-id <selection-id> --query "BackupSelection.Resources" --output text
```

- If your table ARN appears in any selection, it is protected by the backup plan.

2. Verify Backup Plan Configuration:

```bash
aws backup get-backup-plan --backup-plan-id <your-backup-plan-id>
```

Look for the "Lifecycle" fields in each backup rule:
- "DeleteAfterDays" is the retention period.
- "ScheduleExpression" sets the backup schedule (cron format).
- "BackupVaultName" is the name of the vault (where backups are stored).

## Expected Result
Timestream tables should be assigned to an AWS Backup plan with appropriate schedule and retention policies configured.

## Remediation

### Using AWS CLI
1. Create Backup Plan for on-demand snapshots:

```bash
aws backup create-backup-plan --backup-plan '{
  "BackupPlanName": "<BackupPlanName>",
  "Rules": [
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
- Update the "ScheduleExpression", "StartWindowMinutes" based on your unique backup schedule.
- Replace "35" with your retention time for PITR if shorter
- Replace "90" with your retention time for Snapshots if different

This command outputs the BackupPlanId necessary for the next step.

2. Assign Timestream Database to the Backup Plan:

Replace <BackupPlanId> with the ID from Step 1 and <TableArn> with your Timestream table ARN.

```bash
aws backup create-backup-selection --backup-plan-id <BackupPlanId> --backup-selection '{ "SelectionName": "timestream-tables", "IamRoleArn": "arn:aws:iam:::role/AWSBackupServiceRolePolicyForBackup", "Resources": ["<TableArn>"] }'
```

- Make sure the IAM role has the necessary AWS Backup permissions.
- These commands create a centralized backup plan with scheduled snapshot backups, then assign your Timestream database as a resource for backup.

## Default Value
Amazon Timestream does not have native automated backups. Backups must be configured through AWS Backup.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 11 Data Recovery | x | x | x |

## Profile
Level 1 | Manual
