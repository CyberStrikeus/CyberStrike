---
name: cis-aws-database-3.14
description: "Ensure Database has delete protection enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, rds, deletion-protection, data-protection, resilience]
cis_id: "3.14"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-3.10]
prerequisites: []
severity_boost: {}
---

# 3.14 Ensure Database has delete protection enabled (Manual)

## Description

Ensure that delete protection is enabled on database instances to prevent accidental or unauthorized deletion. This setting safeguards critical databases by requiring explicit disabling of delete protection before deletion, reducing the risk of data loss through human error or malicious activity.

## Rationale

Delete protection provides a safeguard against inadvertent or malicious deletion of critical databases. By requiring deliberate action to disable deletion protection, organizations mitigate risks associated with accidental data deletion and enhance the overall resilience of their data storage platform.

## Impact

Failure to enable delete protection increases the risk of irreversible data loss, potential service disruption, and operational downtime.

## Audit Procedure

### Using AWS CLI

Run the following command to check if deletion protection is enabled on your RDS DB cluster(s):

```bash
aws rds describe-db-clusters \
  --query "DBClusters[*].{DBClusterIdentifier:DBClusterIdentifier,DeletionProtection:DeletionProtection}" \
  --output table
```

- Review each cluster's DeletionProtection status.
- Clusters marked as true have deletion protection enabled.
- Identify any clusters with deletion protection disabled for remediation.

### Using AWS Console

1. Navigate to the Amazon RDS console.
2. Select the DB cluster.
3. Under the Configuration tab, check the value of Deletion protection.
4. Verify it is set to Enabled.

## Expected Result

All production RDS DB clusters should have `DeletionProtection` set to `true`.

## Remediation

### Using AWS CLI

To enable deletion protection on an existing RDS DB cluster:

```bash
aws rds modify-db-cluster \
  --db-cluster-identifier <your-cluster-name> \
  --deletion-protection \
  --apply-immediately
```

- Replace with your RDS cluster ID.
- This change is applied immediately without downtime.
- Once enabled, the cluster cannot be deleted without first disabling deletion protection.

### Using AWS Console

1. Navigate to the Amazon RDS console.
2. Select the DB cluster.
3. Click Modify.
4. Under Deletion protection, enable the option.
5. Click Continue and apply the changes immediately.

## Default Value

Deletion protection is disabled by default when creating a new RDS DB cluster.

## References

1. https://aws.amazon.com/products/databases/
2. https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_DeleteInstance.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4 Secure Configuration of Enterprise Assets and Software | | | |

## Profile

Level 1 | Manual
