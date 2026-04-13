---
name: cis-aws-database-2.11
description: "Ensure Database has delete protection enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, aurora, deletion-protection, data-protection, availability]
cis_id: "2.11"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-2.8]
prerequisites: []
severity_boost: {}
---

# 2.11 Ensure Database has delete protection enabled (Manual)

## Description

Ensure that delete protection is enabled on database instances to prevent accidental or unauthorized deletion. This setting safeguards critical databases by requiring explicit disabling of delete protection before deletion, reducing the risk of data loss through human error or malicious activity.

## Rationale

Delete protection provides a safeguard against inadvertent or malicious deletion of critical databases. By requiring deliberate action to disable deletion protection, organizations mitigate risks associated with accidental data deletion and enhance the overall resilience of their data storage platform.

## Impact

Failure to enable delete protection increases the risk of irreversible data loss, potential service disruption, and operational downtime.

## Audit Procedure

### Using AWS CLI

Run the following command to check if deletion protection is enabled on your Aurora DB cluster(s):

```bash
aws rds describe-db-clusters \
  --query "DBClusters[*].{DBClusterIdentifier:DBClusterIdentifier,DeletionProtection:DeletionProtection}" \
  --output table
```

- Review each cluster's DeletionProtection status.
- Clusters marked as true have deletion protection enabled.
- Identify any clusters with deletion protection disabled for remediation.

## Expected Result

The `DeletionProtection` field should be `true` for all Aurora DB clusters.

## Remediation

### Using AWS CLI

1. To enable deletion protection on an existing Aurora DB cluster:

```bash
aws rds modify-db-cluster \
  --db-cluster-identifier <your-cluster-name> \
  --deletion-protection \
  --apply-immediately
```

- Replace with your Aurora cluster ID.
- This change is applied immediately without downtime.
- Once enabled, the cluster cannot be deleted without first disabling deletion protection.

## Default Value

Deletion protection is enabled by default when creating a new Aurora DB cluster through the AWS Console, but it may not be enabled by default when using the AWS CLI or CloudFormation.

## References

- https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4 Secure Configuration of Enterprise Assets and Software - Establish and maintain the secure configuration of enterprise assets (end-user devices, including portable and mobile; network devices; non-computing/IoT devices; and servers) and software (operating systems and applications). | | | |

## Profile

Level 1 | Manual
