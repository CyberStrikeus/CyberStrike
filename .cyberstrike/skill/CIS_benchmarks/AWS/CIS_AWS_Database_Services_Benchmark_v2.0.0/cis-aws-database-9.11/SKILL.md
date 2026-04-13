---
name: cis-aws-database-9.11
description: "Ensure Neptune DB instances are deployed across multiple Availability Zones (AZs)"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, neptune, graph-database, multi-az, high-availability]
cis_id: "9.11"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-9.8, cis-aws-database-9.9, cis-aws-database-9.10]
prerequisites: []
severity_boost: {}
---

# 9.11 Ensure Neptune DB instances are deployed across multiple Availability Zones (AZs) (Manual)

## Description

Deploying Amazon Neptune across multiple Availability Zones means configuring the database cluster nodes (primary and replicas) to be distributed in different AZs within the same AWS region. This multi-AZ deployment improves fault tolerance and availability by mitigating risks associated with failure or degradation in a single Availability Zone. If the primary node or an AZ becomes unavailable, Neptune can automatically fail over to a replica in a different AZ, minimizing downtime and data unavailability.

## Rationale

Distributing Neptune DBs across multiple AZs protects the database from localized infrastructure failures, such as power outages, networking disruptions, or hardware faults in a single AZ.

## Impact

Enabling multi-AZ deployment for Neptune DBs enhances system availability and resiliency, significantly reducing the risk of cache service interruptions due to an AZ failure or node disruption.

## Audit Procedure

### Using AWS CLI

List Multi-AZ status for all Neptune DB clusters:

```bash
aws neptune describe-db-clusters \
  --query "DBClusters[*].{DBClusterIdentifier:DBClusterIdentifier,Engine:Engine,MultiAZ:MultiAZ}"
```

- MultiAZ: true => Multi-AZ is enabled (compliant).
- MultiAZ: false => Multi-AZ is not enabled (non-compliant).

## Expected Result

All Neptune DB clusters should have `MultiAZ` set to `true`.

## Remediation

### Using AWS Console

Enable Multi-AZ on Neptune DB clusters by adding a reader replica in a different Availability Zone:

1. Sign in to the AWS Management Console where the Aurora database cluster you are auditing resides.
2. Navigate to the Neptune Dashboard. You can find this under the Database category.
3. Select the DB cluster where you want to create the reader instance.
4. Choose Actions, and then choose Add reader.
5. Configure the replica DB instance. On the Create replica DB instance page, specify the following options:
   - DB instance class: Choose a DB instance class that matches or aligns with your primary instance (e.g., db.r5.large). This defines the processing and memory requirements for the Neptune replica.
   - Availability zone: Specify a different Availability Zone than the primary DB instance. This is critical for Multi-AZ deployment. The list shows only AZs that are mapped by the DB subnet group for the cluster.
   - Encryption: Enable or disable encryption (recommended: enable if primary has encryption enabled).
   - Read replica source: Choose the identifier of the primary instance to create the Neptune replica for.
   - DB instance identifier: Enter a unique name for the instance in your region. Consider including the AZ in the name (e.g., neptune-replica-us-east-1b).
   - Database port: Specify the port number on which the database accepts connections (default: 8182 for Neptune).
   - DB parameter group: Select the parameter group for this instance (typically the same as the primary).
   - Log exports: Choose any logs you want to publish (audit, slowquery, etc.).
   - Auto Minor Version Upgrade: Choose Yes to enable automatic minor version upgrades for the replica.
6. Choose Create read replica to create the Neptune replica instance.

## Default Value

Neptune clusters are not deployed in multi-AZ configuration by default. A reader replica must be manually added in a different AZ.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4 Secure Configuration of Enterprise Assets and Software |      |      |      |

## Profile

Level 2 | Manual
