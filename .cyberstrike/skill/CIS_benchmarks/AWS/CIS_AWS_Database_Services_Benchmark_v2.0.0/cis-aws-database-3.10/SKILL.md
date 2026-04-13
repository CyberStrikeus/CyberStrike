---
name: cis-aws-database-3.10
description: "Ensure to Enable Backup and Recovery"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, rds, backup, recovery, snapshot, point-in-time]
cis_id: "3.10"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-3.2, cis-aws-database-3.14]
prerequisites: []
severity_boost: {}
---

# 3.10 Ensure to Enable Backup and Recovery (Manual)

## Description

The individual logs into their AWS account and chooses their Amazon relational database that they want to backup. To have the database being backed up automatically the individual is encouraged to enable backup. This ensures that the file is being saved automatically and can prevent it from accidental loss. This ensures that the individual can restore their files quickly in the event of a data loss.

## Rationale

Backups are essential for data protection, disaster recovery, and business continuity. Enabling automated backups ensures data can be restored in the event of accidental deletion, corruption, or system failure.

## Impact

It would result in having the files protected and being able to retrieve those files in the event of an accidental loss.

## Audit Procedure

### Using AWS Console

1. Sign into the AWS Management Console
   - Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon RDS Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/rds/.

3. Select the RDS Instance
   - Choose the Amazon RDS instance you want to implement backup and recovery.
   - Click on the instance name to access its details page.
   - In the instance details page, navigate to the `Backup & Restore` or `Backup` section.

4. Configure Automated Backups
   - Under the `Backup` section.
   - Click the `Modify` or `Edit` option to configure automated backups.
   - Enable automated backups by selecting the desired backup retention period.
   - Specify the preferred backup window during which automated backups can occur.
   - Choose whether to enable Multi-AZ backups for enhanced durability and availability.
   - Click `Continue` or `Save` to apply the changes.

5. Restore from Backups
   - In the Amazon RDS console, click on `Snapshots` or `Instances` in the left-side menu.
   - Select the snapshot or instance from which you want to perform a restore.
   - Click `Restore snapshot` or `Restore to point in time` to initiate restoration.
   - Configure the parameters for the restored instance, such as instance identifier, instance class, storage type, and VPC settings.
   - Specify the desired option for creating a new DB instance or restoring to an existing DB instance.
   - Configure additional settings, such as enabling Multi-AZ deployment or enabling encryption.
   - Click "Restore" or "Create" to initiate the restore process.

6. Test and Validate the Restored Instance
   - After completing the restore process, test the restored RDS instance to ensure it functions as expected.
   - Verify the data, configuration, and connectivity of the restored instance.

7. Monitor and Manage Backups
   - Regularly monitor the status and health of your automated backups and manual snapshots.
   - Review the backup retention policy and adjust it to align with your business requirements.
   - Manage and delete older backups or snapshots to free up storage and reduce costs.

8. Perform Point-in-Time Recovery (Optional)
   - In the Amazon RDS console, click on "Snapshots" or `Instances` in the left-side menu.
   - Select the instance for which you want to perform point-in-time recovery.
   - Click on `Restore to point in time` to initiate the point-in-time recovery process.
   - Specify the desired timestamp or time range to restore to.
   - Configure the parameters for the restored instance, similar to the restore from the backup process.
   - Click `Restore` or "Create" to initiate the point-in-time recovery process.

## Expected Result

Automated backups should be enabled with an appropriate retention period (minimum 7 days recommended), and the backup window should be configured during low-traffic periods.

## Remediation

### Using AWS Console

Follow the audit steps above to enable automated backups. Set the backup retention period to at least 7 days and configure a preferred backup window.

## Default Value

Automated backups are enabled by default with a 1-day retention period when creating a new RDS instance.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 11 Data Recovery | | | |
| v7 | 10 Data Recovery Capabilities | | | |

## Profile

Level 1 | Manual
