---
name: cis-aws-database-5.12
description: "Ensure ElastiCache is deployed across multiple Availability Zones (AZs)"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, elasticache, redis, multi-az, high-availability, failover]
cis_id: "5.12"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-5.11]
prerequisites: []
severity_boost: {}
---

# 5.12 Ensure ElastiCache is deployed across multiple Availability Zones (AZs)

## Description

Deploying Amazon ElastiCache across multiple Availability Zones means configuring the cache cluster nodes (primary and replicas) to be distributed in different AZs within the same AWS region. This multi-AZ deployment improves fault tolerance and availability by mitigating risks associated with failure or degradation in a single Availability Zone. If the primary node or an AZ becomes unavailable, ElastiCache can automatically fail over to a replica in a different AZ, minimizing downtime and data unavailability.

## Rationale

Distributing ElastiCache nodes across multiple AZs protects the caching layer from localized infrastructure failures, such as power outages, networking disruptions, or hardware faults in a single AZ.

## Impact

Enabling multi-AZ deployment for ElastiCache clusters enhances system availability and resiliency, significantly reducing the risk of cache service interruptions due to an AZ failure or node disruption.

## Audit Procedure

### Using AWS CLI

Audit All Replication Groups for Multi-AZ Status:

```bash
aws elasticache describe-replication-groups --query "ReplicationGroups[*].{ID:ReplicationGroupId,MultiAZ:MultiAZ}"
```

This returns true if Multi-AZ with automatic failover is enabled, otherwise false.

## Expected Result

All replication groups show `MultiAZ: enabled`.

## Remediation

### Using AWS CLI

**1. Prerequisites for Enabling Multi-AZ on ElastiCache:**

- VPC with Subnets in Multiple Availability Zones: The VPC associated with your ElastiCache replication group must have at least two subnets in different Availability Zones within the same AWS Region.
- Cache Subnet Group Configuration: The cache subnet group used by the replication group must include multiple subnets spanning the desired AZs to support node placement.
- Replication Group with At Least One Replica: Multi-AZ requires a primary node and at least one read replica that can be deployed in a different AZ to support automatic failover.
- Automatic Failover Enabled: Failover between primary and replicas is automatic with Multi-AZ, so automatic failover must be enabled on the replication group (can be set at creation or modified later).

**2. Modify the Replication Group to Enable Multi-AZ:**

```bash
aws elasticache modify-replication-group \
  --replication-group-id <your-replication-group-id> \
  --multi-az-enabled \
  --apply-immediately
```

- This command enables Multi-AZ with automatic failover for the specified replication group.
- The --apply-immediately flag ensures the change happens without waiting for the next maintenance window. Use with caution in production.

## Default Value

By default, Multi-AZ is not enabled for ElastiCache replication groups.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4 Secure Configuration of Enterprise Assets and Software |      |      |      |

## Profile

Level 2 | Manual
