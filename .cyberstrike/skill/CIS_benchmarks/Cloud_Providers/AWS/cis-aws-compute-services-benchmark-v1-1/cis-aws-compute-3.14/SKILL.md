---
name: cis-aws-compute-3.14
description: "Ensure 'assignPublicIp' is set to 'DISABLED' for Amazon ECS task sets"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ecs, containers, task-sets, networking, public-ip]
cis_id: "3.14"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-3.2]
prerequisites: []
severity_boost: {}
---

# Ensure 'assignPublicIp' is set to 'DISABLED' for Amazon ECS task sets

## Description

Ensure that `assignPublicIp` is set to `DISABLED` for Amazon ECS task sets, to prevent task sets from being publicly accessible.

## Rationale

Enabling public IP assignment could expose task sets to unintended or unauthorized access.

## Impact

Disabling `assignPublicIp` introduces administrative, operational, and potential cost overhead due to the need to configure and maintain private networking and associated resources.

## Audit Procedure

### Using AWS Console

No specific console audit steps provided. Use the CLI audit procedure below.

### Using AWS CLI

Run the following command to list clusters:

```
aws ecs list-clusters
```

Run the following command to list services in a cluster:

```
aws ecs list-services --cluster <cluster-arn>
```

Run the following command to view the task sets for a service:

```
aws ecs describe-task-sets --cluster <cluster-arn> --service <service-arn>
```

For each task set, under `networkConfiguration` > `awsvpcConfiguration`, ensure `assignPublicIp` is set to `DISABLED`.
Repeat for each cluster and service.

## Expected Result

`assignPublicIp` should be set to `DISABLED` under `networkConfiguration` > `awsvpcConfiguration` for all ECS task sets.

## Remediation

### Using AWS Console

No specific console remediation steps provided. Use the CLI or update the service/task set configuration directly.

### Using AWS CLI

No specific CLI remediation command provided. Task sets are typically managed through service deployments. Update the service configuration to ensure new task sets use `assignPublicIp` set to `DISABLED`.

## Default Value

By default, `assignPublicIp` is set to `ENABLED`.

## References

1. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/describe-task-sets.html
2. https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_TaskSet.html

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

Level 1 | Automated
