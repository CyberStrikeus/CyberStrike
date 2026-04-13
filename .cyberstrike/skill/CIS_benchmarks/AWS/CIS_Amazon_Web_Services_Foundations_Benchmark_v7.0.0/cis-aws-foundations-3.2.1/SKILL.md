---
name: cis-aws-foundations-3.2.1
description: "Ensure that encryption-at-rest is enabled for RDS instances"
category: cis-storage
version: "7.0.0"
author: cyberstrike-official
tags: [cis, aws, storage, rds, encryption, encryption-at-rest, kms]
cis_id: "3.2.1"
cis_benchmark: "CIS AWS Foundations Benchmark v7.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-foundations-3.2.2, cis-aws-foundations-3.2.3, cis-aws-foundations-3.2.4]
prerequisites: []
severity_boost: {}
---

# Ensure that encryption-at-rest is enabled for RDS instances

## Description
Amazon RDS encrypted DB instances use the industry-standard AES-256 encryption algorithm to encrypt your data on the server that hosts your Amazon RDS DB instances. After your data is encrypted, Amazon RDS handles the authentication of access and the decryption of your data transparently, with minimal impact on performance.

## Rationale
Databases are likely to hold sensitive and critical data; therefore, it is highly recommended to implement encryption to protect your data from unauthorized access or disclosure. With RDS encryption enabled, the data stored on the instance's underlying storage, the automated backups, read replicas, and snapshots are all encrypted.

## Impact
Enabling encryption requires creating a new encrypted instance from a snapshot. This involves downtime and potential application configuration changes. For production databases, consider implementing replication or planned downtime to ensure data consistency during migration.

## Audit Procedure

### Using AWS Console
1. Login to the AWS Management Console and open the RDS dashboard at https://console.aws.amazon.com/rds/.
2. In the navigation pane, under RDS dashboard, click `Databases`.
3. Select the RDS instance that you want to examine.
4. Click `Instance Name` to see details, then select the `Configuration` tab.
5. Under Configuration Details, in the Primary Storage pane, search for the `Encryption Enabled` status.
6. If the current status is set to `Disabled`, encryption is not enabled for the selected RDS database instance.
7. Repeat steps 2 to 6 to verify the encryption status of other RDS instances in the same region.
8. Change the region from the top of the navigation bar, and repeat the audit steps for other regions.

### Using AWS CLI
1. Run the `describe-db-instances` command to list all the RDS database instance names available in the selected AWS region. The output will return each database instance identifier (name):

```bash
aws rds describe-db-instances --region --query 'DBInstances[*].[DBInstanceIdentifier,StorageEncrypted]' --output table
```

2. Run the `describe-db-instances` command again, using an RDS instance identifier returned from step 1, to determine if the selected database instance is encrypted. The output should return the encryption status `True` or `False`:

```bash
aws rds describe-db-instances --region <region-name> --db-instance-identifier <db-name> --query 'DBInstances[*].StorageEncrypted'
```

3. If the StorageEncrypted parameter value is `False`, encryption is not enabled for the selected RDS database instance.
4. Repeat steps 1 to 3 to audit each RDS instance, and change the region to verify RDS instances in other regions.

## Expected Result
The `StorageEncrypted` parameter should return `True` for all RDS database instances, indicating that encryption at rest is enabled.

## Remediation

### Using AWS Console
1. Login to the AWS Management Console and open the RDS dashboard at https://console.aws.amazon.com/rds/.
2. In the left navigation panel, click on `Databases`.
3. Select the Database instance that needs to be encrypted.
4. Click the `Actions` button placed at the top right and select `Take Snapshot`.
5. On the Take Snapshot page, enter the name of the database for which you want to take a snapshot in the `Snapshot Name` field and click on `Take Snapshot`.
6. Select the newly created snapshot, click the `Action` button placed at the top right, and select `Copy snapshot` from the Action menu.
7. On the Make Copy of DB Snapshot page, perform the following:
   - In the `New DB Snapshot Identifier` field, enter a name for the new snapshot.
   - Check `Copy Tags`. The new snapshot must have the same tags as the source snapshot.
   - Select `Yes` from the `Enable Encryption` dropdown list to enable encryption. You can choose to use the AWS default encryption key or a custom key from the Master Key dropdown list.
8. Click `Copy Snapshot` to create an encrypted copy of the selected instance's snapshot.
9. Select the new Snapshot Encrypted Copy and click the `Action` button located at the top right. Then, select the `Restore Snapshot` option from the Action menu. This will restore the encrypted snapshot to a new database instance.
10. On the Restore DB Instance page, enter a unique name for the new database instance in the DB Instance Identifier field.
11. Review the instance configuration details and click `Restore DB Instance`.
12. After the new instance is provisioned:
    - Update application configuration to use the new encrypted database endpoint
    - Remove the unencrypted instance once migration is complete

Note: This remediation procedure assumes that the database has been taken offline (or operating in read-only mode) and is static when the snapshot is taken. If the database is still in use, any changes made between the time the snapshot is made and the new encrypted database is brought online will be lost.

### Using AWS CLI
1. List all RDS database instances:

```bash
aws rds describe-db-instances --region <region-name> --query 'DBInstances[*].DBInstanceIdentifier'
```

2. Check if the instance is encrypted:

```bash
aws rds describe-db-instances --region <region-name> --db-instance-identifier <db-name> --query 'DBInstances[*].StorageEncrypted'
```

3. Create a snapshot:

```bash
aws rds create-db-snapshot --region <region-name> --db-snapshot-identifier <db-snapshot-name> --db-instance-identifier <db-name>
```

4. List KMS key aliases:

```bash
aws kms list-aliases --region <region-name>
```

5. Create an encrypted copy of the snapshot:

```bash
aws rds copy-db-snapshot --region <region> \
  --source-db-snapshot-identifier <source-snapshot> \
  --target-db-snapshot-identifier <target-snapshot> \
  --copy-tags \
  --kms-key-id <kms-key-id>
```

6. Restore the encrypted snapshot (default VPC):

```bash
aws rds restore-db-instance-from-db-snapshot --region <region> \
  --db-instance-identifier <new-db-name> \
  --db-snapshot-identifier <snapshot-name>
```

7. (Optional) Create a DB subnet group (if using custom VPC):

```bash
aws rds create-db-subnet-group \
  --db-subnet-group-name <name> \
  --db-subnet-group-description <description> \
  --subnet-ids '["subnet-1","subnet-2","subnet-3"]'
```

8. Restore using the subnet group:

```bash
aws rds restore-db-instance-from-db-snapshot --region <region> \
  --db-subnet-group-name <subnet-group> \
  --db-instance-identifier <new-db-name> \
  --db-snapshot-identifier <snapshot-name>
```

9. Verify the new database instance:

```bash
aws rds describe-db-instances --region <region> --query 'DBInstances[*].DBInstanceIdentifier'
```

10. Confirm encryption is enabled:

```bash
aws rds describe-db-instances --region <region> \
  --db-instance-identifier <db-name> \
  --query 'DBInstances[*].StorageEncrypted'
```

## Default Value
By default, Amazon RDS instances are created without encryption at rest. Encryption must be explicitly enabled at instance creation or by restoring from an encrypted snapshot.

## References
1. https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html
2. https://aws.amazon.com/blogs/database/selecting-the-right-encryption-options-for-amazon-rds-and-amazon-aurora-database-engines/
3. https://aws.amazon.com/rds/features/security/
4. https://docs.aws.amazon.com/cli/latest/reference/rds/create-db-subnet-group.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | x | x |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1530 | TA0010 | M1041 |

## Profile
Level 1 | Automated
