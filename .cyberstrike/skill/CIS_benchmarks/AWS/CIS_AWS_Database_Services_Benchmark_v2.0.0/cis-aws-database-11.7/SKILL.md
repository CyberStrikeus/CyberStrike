---
name: cis-aws-database-11.7
description: "Ensure to Enable Backup and Recovery"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, qldb, ledger, backup, recovery, disaster-recovery]
cis_id: "11.7"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-11.5, cis-aws-database-11.6]
prerequisites: []
severity_boost: {}
---

# 11.7 Ensure to Enable Backup and Recovery (Manual)

## Description
Having the data backed up ensures that all the crucial information is stored securely it defends against any human errors and system errors that resulted in data loss. An organization that has a disaster recovery plan is prepared for any disruption that would impact business operations.

## Rationale
Backup and recovery ensures business continuity and data protection for QLDB ledger data against accidental deletion, corruption, and system failures.

## Impact
If a business does not have a backup and recovery plan it would have a negative impact on the business, which would result in less productivity, suffer data loss that cannot be restored, and loss of revenue.

## Audit Procedure

### Using AWS Console
1. Understand QLDB Backup and Recovery Features:
   - Familiarize yourself with the built-in backup and recovery capabilities provided by QLDB.
   - Understand the concepts of ledgers, revisions, and journal export for backup and restore operations.
2. Determine Backup and Recovery Requirements:
   - Assess your organization's backup and recovery requirements for QLDB.
   - Define the recovery point objective (RPO) and recovery time objective (RTO) that align with your business needs.
   - Determine the desired backup frequency and retention period for your QLDB data.
3. Enable Automatic Backups:
   - Open the Amazon QLDB console.
   - Select the QLDB ledger for which you want to enable automatic backups.
   - Click on the `Configuration` tab.
   - Under the `Backup` section, enable automatic backups.
   - Specify the desired backup retention period for the automatic backups.
4. Perform Manual Backups (Optional):
   - If you need additional backups or want to perform on-demand backups, initiate manual backups.
   - Open the Amazon QLDB console.
   - Select the QLDB ledger you want to back up.
   - Click on the `Backups` tab.
   - Choose the `Create Backup` option.
   - Provide a meaningful backup name and initiate the backup process.
5. Restore QLDB from Backups:
   - Open the Amazon QLDB console.
   - Go to the `Backups` tab.
   - Select the backup from which you want to restore the QLDB ledger.
   - Click on the `Restore` option.
   - Specify the desired restoration name and initiate the restoration process.
6. Regularly Test Restore Process:
   - Periodically test the restore process to ensure that backups are working correctly.
   - Select a backup and initiate the restoration to a separate QLDB ledger.
   - Verify that the restored ledger contains the expected data and is accessible.
7. Implement Data Archiving (Optional):
   - If you require long-term data retention or compliance with specific data retention policies, consider implementing data archiving strategies.
   - Leverage AWS services like Amazon S3 for long-term storage of QLDB journal exports or backups.
8. Disaster Recovery Planning:
   - Develop a comprehensive disaster recovery plan for QLDB to mitigate the impact of catastrophic events.
   - Consider implementing cross-region replication or multi-region deployments to provide geographic redundancy.
   - Test the disaster recovery plan periodically to validate its effectiveness.
9. Monitor Backup and Recovery Operations:
   - Regularly monitor backup and recovery operations using Amazon CloudWatch and AWS CloudTrail.
   - Set up appropriate alarms and notifications to ensure timely identification of any backup or recovery issues.

## Expected Result
Automatic backups should be enabled for QLDB ledgers with appropriate retention periods. The restore process should be regularly tested to ensure data recoverability.

## Remediation

### Using AWS Console
Follow the audit steps above to enable backup and recovery for your Amazon QLDB ledgers.

## Default Value
QLDB provides an immutable journal by design. Export to S3 and backup features must be manually configured.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 11 Data Recovery | x | x | x |

## Profile
Level 1 | Manual
