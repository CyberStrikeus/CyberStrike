---
name: cis-aws-database-7.9
description: "Ensure to Implement Backup and Disaster Recovery"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, documentdb, backup, disaster-recovery, automated-backups]
cis_id: "7.9"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-7.10, cis-aws-database-7.11]
prerequisites: []
severity_boost: {}
---

# 7.9 Ensure to Implement Backup and Disaster Recovery (Manual)

## Description

Set up automated backups for your DocumentDB instances to ensure data durability and recoverability. Consider implementing a disaster recovery plan that includes data replication across different availability zones or regions.

## Rationale

Having the data backed up ensures that all the crucial information is stored securely it defends against any human errors and system errors that resulted in data loss. An organization that has a disaster recovery plan is prepared for any disruption that would impact business operations.

## Impact

If a business does not have a backup and recovery plan it would have a negative impact on the business, which would result in less productivity, suffer data loss that cannot be restored, and loss of revenue.

## Audit Procedure

### Using AWS Console

1. Sign into the AWS Management Console
   - Sign into the AWS Management Console at https://console.aws.amazon.com/ with your AWS account credentials.

2. Open the Amazon DocumentDB Console
   - Navigate to the service using the `Find Services` search bar or by directly accessing the console at https://console.aws.amazon.com/docdb/.

3. Select the DocumentDB Cluster
   - Choose the Amazon DocumentDB cluster for which you want to implement backup and disaster recovery.
   - Click on the cluster name to access its details page.
   - In the cluster details page, navigate to the "Backup" section.

4. Enable Automated Backups
   - Under the `Automated backups` section.
   - Click on the `Edit` button or `Modify` option to configure automated backup settings.
   - Enable automated backups by choosing the desired backup retention period.
   - Specify the number of days for which automated backups should be retained.

## Expected Result

Automated backups are enabled for all DocumentDB clusters with an appropriate retention period configured, and a disaster recovery plan is in place.

## Remediation

### Using AWS Console

Follow the audit procedure steps to enable automated backups for each DocumentDB cluster. Configure an appropriate backup retention period and consider cross-region replication for disaster recovery.

## Default Value

Amazon DocumentDB enables automated backups by default with a 1-day retention period.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 11 Data Recovery | | | |
| v7 | 10 Data Recovery Capabilities | | | |

## Profile

Level 1 | Manual
