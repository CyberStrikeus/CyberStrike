---
name: cis-aws-database-5.11
description: "Ensure ElastiCache has Cluster Mode Enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, elasticache, redis, cluster-mode, high-availability, scaling]
cis_id: "5.11"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-5.12]
prerequisites: []
severity_boost: {}
---

# 5.11 Ensure ElastiCache has Cluster Mode Enabled

## Description
Cluster Mode Enabled for ElastiCache distributes data across multiple shards, enabling horizontal scaling, higher availability, and isolating potential failures or resource exhaustion to a subset of the data set, rather than the entire cluster.

## Rationale
Enabling Cluster Mode reduces the risk of service outage from node failures, hardware limits, or scaling bottlenecks. Data partitioning across shards allows zero-downtime horizontal scaling, automated failover, and better resource utilization in production workloads, especially under high load or large data sets.

## Impact
Enabling Cluster Mode transforms ElastiCache from a single fault domain into a distributed, highly available system.

## Audit Procedure

### Using AWS CLI
List Cluster Mode Status for All Replication Groups:

```bash
aws elasticache describe-replication-groups \
  --query "ReplicationGroups[*].{ReplicationGroupId:ReplicationGroupId,ClusterModeEnabled:ClusterEnabled}"
```

- This will output a concise list showing each cluster's ID and whether Cluster Mode is enabled (true) or not (false).
- Review and flag any replication group entries where "ClusterModeEnabled": false.

## Expected Result
All replication groups show `ClusterModeEnabled: true`.

## Remediation

### Using AWS CLI
Migration from Cluster Mode Disabled (CMD) to Cluster Mode Enabled (CME) is possible via the cluster mode compatible feature provided by AWS.

**1. Pre-requisites:**
- The cluster may only have keys in database 0 only.
- Applications must use a Valkey or Redis OSS client that is capable of using Cluster protocol and use a configuration endpoint.
- Auto-failover must be enabled on the cluster with a minimum of 1 replica.
- The minimum engine version required for migration is Valkey 7.2 and above, or Redis OSS 7.0 and above.

**2. Modify Cluster Mode to Compatible**

Change the existing replication group cluster mode from disabled to Compatible:

```bash
aws elasticache modify-replication-group \
  --replication-group-id <your-replication-group-id> \
  --cluster-mode compatible \
  --apply-immediately
```

- In this mode, ElastiCache behaves as a single shard cluster but supports both cluster mode enabled and disabled client connections.

**3. Migrate All Clients to Cluster Mode Enabled**
- Update your application clients to support the cluster protocol using the cluster configuration endpoint.
- Validate application behavior in this intermediate compatible mode.
- This allows your client applications to start transitioning to the cluster-aware mode while maintaining backward compatibility.

**4. Complete Cluster Mode Configuration**

Once all client applications have been migrated and validated, finalize the cluster mode by switching from Compatible to Enabled:

```bash
aws elasticache modify-replication-group \
  --replication-group-id <your-replication-group-id> \
  --cluster-mode enabled \
  --apply-immediately
```

- This enforces cluster mode fully, allowing scaling and other cluster features to be enabled.

## Default Value
By default, Cluster Mode may not be enabled for ElastiCache replication groups.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4 Secure Configuration of Enterprise Assets and Software | | | |

## Profile
Level 2 | Manual
