---
name: cis-aws-compute-3.9
description: "Ensure monitoring is enabled for Amazon ECS clusters"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ecs, containers, monitoring, cloudwatch, container-insights, clusters]
cis_id: "3.9"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-3.7]
prerequisites: []
severity_boost: {}
---

# Ensure monitoring is enabled for Amazon ECS clusters

## Description
Enable AWS CloudWatch Container Insights for Amazon ECS clusters to monitor resource usage, performance, and application health through metrics and logs.

## Rationale
Monitoring ECS clusters with Container Insights improves visibility, supports faster issue detection, and enhances security by identifying anomalies and resource bottlenecks.

## Impact
Enabling AWS CloudWatch Container Insights for ECS clusters incurs costs for metrics, log ingestion, storage, and alarms.

## Audit Procedure

### Using AWS Console
1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Clusters`.
3. For each cluster listed in the `CloudWatch monitoring` column, ensure that `Container Insights` is displayed.

### Using AWS CLI
Run the following command to list clusters:
```
aws ecs list-clusters
```

Run the following command to view the settings for a cluster:
```
aws ecs describe-clusters --clusters <cluster-arn> --include SETTINGS --query 'clusters[*].settings'
```

Ensure `containerInsights` is set to `enabled` or `enhanced`.

## Expected Result
`containerInsights` should be set to `enabled` or `enhanced` for all ECS clusters.

## Remediation

### Using AWS Console
1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Clusters`.
3. Click the name of a cluster.
4. Click `Update cluster`.
5. Under `Monitoring`, select the radio button next to `Container Insights` or `Container Insights with enhanced observability`.
6. Click `Update`.
7. Repeat steps 1-6 for each ECS cluster requiring remediation.

### Using AWS CLI
For each cluster requiring remediation, run the following command to enable `containerInsights`:
```
aws ecs update-cluster-settings --cluster <cluster-arn> --settings name=containerInsights,value=enabled
```

## Default Value
Monitoring is disabled by default for Amazon ECS clusters.

## References
1. https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ContainerInsights.html
2. https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/container-insights-detailed-ecs-metrics.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.5 Collect Detailed Audit Logs | | x | x |
| v7 | 6.3 Enable Detailed Logging | | x | x |

## Profile
Level 2 | Automated
