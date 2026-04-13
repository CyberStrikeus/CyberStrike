---
name: cis-aws-storage-1.3
description: "Ensure to create backup template and name"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, backup, aws-backup, backup-plan, s3, elastic-beanstalk]
cis_id: "1.3"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-1.1, cis-aws-storage-1.2, cis-aws-storage-1.4]
prerequisites: [cis-aws-storage-1.1]
severity_boost: {}
---

# CIS Control 1.3: Ensure to create backup template and name (Manual)

## Profile Applicability

- **Level 2**

## Description

To create a backup plan, select a template and specify a name for the plan. Additionally, define backup rules according to your requirements and then click on create backup option.

## Rationale

Creating well-named backup templates ensures consistency, improves manageability, and helps teams understand backup configurations at a glance. Backup plans define the schedule, retention, and lifecycle policies for your backups.

## Impact

Not properly creating and naming backup templates can lead to:
- Inconsistent backup configurations across resources
- Difficulty identifying which resources are protected
- Confusion during disaster recovery scenarios
- Inability to meet compliance requirements for data retention

## Audit Procedure

### Via AWS Management Console

**Backup Resources:**

Once you've made your backup plan, it's time to put it into action and start backing up your stuff.

Let's start by backing up an S3 storage bucket.

To back up Elastic Beanstalk instance stored on AWS S3, we'll need to tag its Amazon Resource Name (ARN) with a backup plan. In S3, go to "properties" to attach the backup plan to the resource:

1. **Copy the ARN from the console**
   - From the AWS Management Console, copy the ARN (Amazon Resource Name) associated with the Elastic Beanstalk instance. This unique identifier will be used to tag the resource for backup

2. **Assign the resource**
   - After copying the ARN, return to the AWS Management Console and access Amazon Backup
   - Choose the backup plan recently created, then proceed to assign the resource you wish to backup, such as the S3 bucket containing the Elastic Beanstalk resource
   - Finally, navigate to "Resource Assignments" to complete the process. Choose "Assign Resources" and provide a name for the assignment. For now, maintain the role as Default. In subsequent sections, we'll explore implementing custom IAM roles and policies for your backup operations

Select the resource(s) that you want to backup. You have the option to backup all your resources, but we're just going to back up the specific Elastic Beanstalk resource for now.

The resources are now being backed up according to the schedule established by your organization.

### Via AWS CLI

```bash
# List all backup plans
aws backup list-backup-plans

# Get details of a specific backup plan
aws backup get-backup-plan --backup-plan-id <PLAN_ID>

# List backup selections (resource assignments)
aws backup list-backup-selections --backup-plan-id <PLAN_ID>

# Get backup selection details
aws backup get-backup-selection \
  --backup-plan-id <PLAN_ID> \
  --selection-id <SELECTION_ID>
```

## Expected Result

- Backup plans have clear, descriptive names following organizational naming conventions
- Backup rules are configured with appropriate schedules
- Resources are tagged and assigned to backup plans
- Backup vault is specified for each backup plan

## Remediation

### Via AWS Management Console

1. **Create Backup Plan with Proper Name**
   - Navigate to AWS Backup → Backup plans
   - Click "Create backup plan"
   - Choose template or build new plan
   - Provide a descriptive name (e.g., `prod-daily-30day-retention`)
   - Define backup rules with schedule and retention

2. **Assign Resources**
   - Navigate to "Resource assignments" in your backup plan
   - Click "Assign resources"
   - Provide assignment name
   - Select resources by tags or resource IDs
   - Choose IAM role for backup operations

### Via AWS CLI

```bash
# Create a backup plan with proper naming
aws backup create-backup-plan --backup-plan '{
  "BackupPlanName": "prod-s3-daily-backups",
  "Rules": [{
    "RuleName": "daily-backup-rule",
    "TargetBackupVaultName": "production-vault",
    "ScheduleExpression": "cron(0 5 ? * * *)",
    "StartWindowMinutes": 60,
    "CompletionWindowMinutes": 120,
    "Lifecycle": {
      "DeleteAfterDays": 30
    }
  }]
}'

# Assign resources to backup plan
aws backup create-backup-selection \
  --backup-plan-id <PLAN_ID> \
  --backup-selection '{
    "SelectionName": "s3-prod-resources",
    "IamRoleArn": "arn:aws:iam::ACCOUNT:role/service-role/AWSBackupDefaultServiceRole",
    "Resources": [
      "arn:aws:s3:::my-bucket-name"
    ]
  }'
```

## Default Value

The AWS backup vault serves as the storage location for your backups. It's crucial to manage access to these backups to prevent unauthorized access and ensure data security.

## References

1. [AWS Backup - How it works](https://docs.aws.amazon.com/aws-backup/latest/devguide/how-it-works.html)
2. [AWS Backup Plans](https://docs.aws.amazon.com/aws-backup/latest/devguide/creating-a-backup-plan.html)

## CIS Controls

Not mapped to specific CIS Controls v7 or v8 in the provided documentation.

## Notes

- This is a **manual** control requiring review of backup plan configurations
- Use consistent naming conventions across all backup plans
- Include environment identifiers in plan names (e.g., prod, dev, staging)
- Document backup plan purposes and resource assignments
- Consider using tags for dynamic resource assignment to backup plans
