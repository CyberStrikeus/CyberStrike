---
name: cis-aws-database-7.10
description: "Ensure to Configure Backup Window"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, documentdb, backup, backup-window, restore]
cis_id: "7.10"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-7.9, cis-aws-database-7.11]
prerequisites: []
severity_boost: {}
---

# 7.10 Ensure to Configure Backup Window (Manual)

## Description

Configure backup windows for Amazon DocumentDB clusters to ensure regular backups are performed during appropriate time periods, and validate backup and restore procedures.

## Rationale

Properly configured backup windows ensure that backups are taken during off-peak hours to minimize performance impact, and regular testing of restore procedures validates data recoverability.

## Impact

Properly configured backup windows minimize the impact on production workloads while ensuring data protection.

## Audit Procedure

### Using AWS Console

1. Perform Manual Backups (Optional)
   - If desired, you can also create manual backups of your DocumentDB cluster.
   - In the cluster details page, navigate to the `Backup` section.
   - Click on the `Create backup` button.
   - Provide a name for the backup and confirm the action.

2. Restore from Backups (Optional)
   - If a disaster occurs or you need to restore your DocumentDB cluster to a previous state, you can restore it from the available backups.
   - In the cluster details page, navigate to the `Backup` section.
   - Choose the backup from which you want to restore.
   - Follow the prompts and provide the necessary information to initiate the restore process.

3. Test Backup and Restore Procedures
   - Periodically test the backup and restore procedures to ensure they work as expected.
   - Perform test restores on non-production environments to validate the integrity and completeness of the backup data.

4. Regularly Monitor and Validate Backups
   - Regularly monitor the backup status and validate that the backups are completed successfully.
   - Monitor backup storage usage to ensure it is within the desired limits and plan for additional storage as needed.

## Expected Result

Backup windows are configured during off-peak hours, manual backups can be created on demand, and restore procedures have been tested and validated.

## Remediation

### Using AWS Console

Follow the audit procedure steps to configure backup windows, perform manual backups, and test restore procedures for each DocumentDB cluster.

## Default Value

Amazon DocumentDB configures an automatic backup window when the cluster is created. The default backup retention period is 1 day.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 11.1 Establish and Maintain a Data Recovery Process | X    | X    | X    |
| v7               | 10.2 Perform Complete System Backups                | X    | X    | X    |

## Profile

Level 1 | Manual
