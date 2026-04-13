---
name: cis-aws-database-7.12
description: "Ensure DocumentDB has delete protection enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, documentdb, delete-protection, data-protection]
cis_id: "7.12"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-7.9, cis-aws-database-7.10]
prerequisites: []
severity_boost: {}
---

# 7.12 Ensure DocumentDB has delete protection enabled (Manual)

## Description

Ensure that delete protection is enabled on database instances to prevent accidental or unauthorized deletion. This setting safeguards critical databases by requiring explicit disabling of delete protection before deletion, reducing the risk of data loss through human error or malicious activity.

## Rationale

Delete protection provides a safeguard against inadvertent or malicious deletion of critical databases. By requiring deliberate action to disable deletion protection, organizations mitigate risks associated with accidental data deletion and enhance the overall resilience of their data storage platform.

## Impact

Failure to enable delete protection increases the risk of irreversible data loss, potential service disruption, and operational downtime.

## Audit Procedure

### Using AWS CLI

List deletion protection status for all DocumentDB clusters:

```bash
aws docdb describe-db-clusters \
  --query "DBClusters[*].{DBClusterIdentifier:DBClusterIdentifier,DeletionProtection:DeletionProtection}"
```

- DeletionProtection: true => Deletion protection is enabled.
- DeletionProtection: false => Deletion protection is not enabled (non-compliant).

## Expected Result

All DocumentDB clusters should have `DeletionProtection` set to `true`.

## Remediation

### Using AWS CLI

Enable deletion protection on a specific cluster:

```bash
aws docdb modify-db-cluster \
  --db-cluster-identifier <cluster-identifier> \
  --deletion-protection \
  --apply-immediately
```

- Replace with your DocDB cluster ID.
- This change is applied immediately without downtime.
- Once enabled, the cluster cannot be deleted without first disabling deletion protection.

## Default Value

Deletion protection is disabled by default when creating a new Amazon DocumentDB cluster.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 11 Data Recovery | | | |

## Profile

Level 1 | Manual
