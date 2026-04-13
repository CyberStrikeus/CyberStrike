---
name: cis-aws-database-9.10
description: "Ensure Database has delete protection enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, neptune, graph-database, delete-protection, data-protection]
cis_id: "9.10"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-9.8, cis-aws-database-9.9, cis-aws-database-9.11]
prerequisites: []
severity_boost: {}
---

# 9.10 Ensure Database has delete protection enabled (Manual)

## Description
Ensure that delete protection is enabled on database instances to prevent accidental or unauthorized deletion. This setting safeguards critical databases by requiring explicit disabling of delete protection before deletion, reducing the risk of data loss through human error or malicious activity.

## Rationale
Delete protection provides a safeguard against inadvertent or malicious deletion of critical databases. By requiring deliberate action to disable deletion protection, organizations mitigate risks associated with accidental data deletion and enhance the overall resilience of their data storage platform.

## Impact
Failure to enable delete protection increases the risk of irreversible data loss, potential service disruption, and operational downtime.

## Audit Procedure

### Using AWS CLI
List deletion protection status for all Neptune DB clusters:

```bash
aws neptune describe-db-clusters \
  --query "DBClusters[*].{DBClusterIdentifier:DBClusterIdentifier,Engine:Engine,DeletionProtection:DeletionProtection}"
```

- DeletionProtection: true => Deletion protection is enabled (compliant).
- DeletionProtection: false => Deletion protection is not enabled (non-compliant).

## Expected Result
All Neptune DB clusters should have `DeletionProtection` set to `true`.

## Remediation

### Using AWS CLI
Enable deletion protection on a specific Neptune cluster:

```bash
aws neptune modify-db-cluster \
  --db-cluster-identifier <cluster-identifier> \
  --deletion-protection \
  --apply-immediately
```

- `--deletion-protection` enables the deletion protection feature.
- `--apply-immediately` applies the change without waiting for the next maintenance window.

## Default Value
Deletion protection is not enabled by default on Neptune DB clusters.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4 Secure Configuration of Enterprise Assets and Software | | | |

## Profile
Level 1 | Manual
