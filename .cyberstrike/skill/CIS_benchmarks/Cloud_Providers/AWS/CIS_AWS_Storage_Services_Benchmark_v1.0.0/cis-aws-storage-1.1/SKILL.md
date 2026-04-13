---
name: cis-aws-storage-1.1
description: "AWS Storage Backups"
category: cis-storage-services
version: "1.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, backup, aws-backup, disaster-recovery, resilience]
cis_id: "1.1"
cis_benchmark: "CIS AWS Storage Services Benchmark v1.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-storage-1.2, cis-aws-storage-1.3, cis-aws-storage-1.4, cis-aws-storage-1.5, cis-aws-storage-1.6]
prerequisites: []
severity_boost: {}
---

# CIS Control 1.1: AWS Storage Backups (Manual)

## Profile Applicability

- **Level 2**

## Description

AWS Storage Backups is a managed AWS Service that establishes high resiliency to your cloud resources. AWS Storage Backups are like making extra copies of your important stuff on Amazon's computers. It is an excellent strategy to ensure that the data and resources you use remain available in the event of unrecoverable damage or loss to your resources.

## Rationale

AWS Backups enable you to back up and restore all data lost during the attack. While AWS Storage Backups provide a level of security, there are numerous methods to fortify your backups, ensuring the protection of your data and services.

## Impact

Not implementing AWS Backups can lead to:

- Permanent data loss during security incidents or system failures
- Extended recovery time in disaster scenarios
- Non-compliance with data retention and disaster recovery requirements
- Business continuity disruption

## Audit Procedure

### Via AWS Management Console

This control requires manual verification of:

1. Whether AWS Backup service is enabled and configured
2. Backup plans exist for critical storage resources
3. Backup schedules are defined according to organizational requirements
4. Backup retention policies align with compliance requirements

### Via AWS CLI

Check if AWS Backup is being used in your account:

```bash
# List backup plans
aws backup list-backup-plans

# List backup vaults
aws backup list-backup-vaults

# List protected resources
aws backup list-protected-resources
```

## Expected Result

- AWS Backup service is enabled
- Backup plans are configured for critical resources
- Backup vaults exist with appropriate access controls
- Protected resources list includes all critical storage assets

## Remediation

### Via AWS Management Console

1. **Sign into AWS Console**
   - Navigate to `https://console.aws.amazon.com/billing/home#/`
   - Enter your credentials

2. **Access AWS Backup Service**
   - In the AWS Management Console, type "Backup" or navigate through the services menu to find the "Storage" category where AWS Backup is listed

3. **Create Backup Plan**
   - Choose "Create backup plan" from the options provided
   - You can either create a custom plan tailored to your requirements or select a pre-defined template offered by AWS

### Via AWS CLI

```bash
# Create a backup vault
aws backup create-backup-vault \
  --backup-vault-name my-backup-vault

# Create a backup plan from a template
aws backup create-backup-plan \
  --backup-plan '{"BackupPlanName":"MyBackupPlan","Rules":[{"RuleName":"DailyBackups","TargetBackupVaultName":"my-backup-vault","ScheduleExpression":"cron(0 5 ? * * *)","StartWindowMinutes":60,"CompletionWindowMinutes":120,"Lifecycle":{"DeleteAfterDays":30}}]}'
```

## Default Value

AWS Backup is not enabled by default. Organizations must manually configure backup plans, vaults, and resource assignments.

## References

1. [AWS Backup - What is Backup](https://docs.aws.amazon.com/aws-backup/latest/devguide/whatisbackup.html)
2. [AWS Backup Documentation](https://docs.aws.amazon.com/aws-backup/)

## CIS Controls

Not mapped to specific CIS Controls v7 or v8 in the provided documentation.

## Notes

- This is a **manual** control requiring human verification
- AWS Backup should be part of a comprehensive disaster recovery strategy
- Consider cross-region backup replication for critical resources
- Regularly test backup restoration procedures
