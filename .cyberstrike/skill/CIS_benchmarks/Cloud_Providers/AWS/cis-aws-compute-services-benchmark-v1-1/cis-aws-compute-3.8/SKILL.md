---
name: cis-aws-compute-3.8
description: "Ensure Amazon ECS Fargate services are using the latest Fargate platform version"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ecs, containers, fargate, platform-version, patching]
cis_id: "3.8"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-3.2, cis-aws-compute-3.9]
prerequisites: []
severity_boost: {}
---

# Ensure Amazon ECS Fargate services are using the latest Fargate platform version

## Description

Ensure that Amazon ECS Fargate services use the latest Fargate platform version to benefit from the latest security enhancements, performance improvements, and feature updates.

## Rationale

Using the latest Fargate platform version ensures services benefit from up-to-date security patches and features.

## Impact

Updating to the latest Fargate platform version may require minor operational effort.

## Audit Procedure

### Using AWS Console

1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Clusters`.
3. Click the name of a cluster.
4. Under `Services`, from the `Filter launch type` drop-down menu, select `FARGATE`.
5. Click the name of a service.
6. Click `Configuration and networking`.
7. Under `Service configuration`, ensure `Platform version` is set to `1.4.0` or `LATEST` for Linux, or `1.0.0` or `LATEST` for Windows.
8. Repeat steps 1-7 for each ECS cluster and Fargate service.

### Using AWS CLI

Run the following command to list clusters:

```
aws ecs list-clusters
```

Run the following command to list services in a cluster:

```
aws ecs list-services --cluster <cluster-arn>
```

Run the following command to view the details of a service:

```
aws ecs describe-services --cluster <cluster-arn> --services <service-arn> --query 'services[*].[platformFamily,platformVersion]' --output table
```

Where `platformFamily` is `Linux`, ensure `platformVersion` is `1.4.0` or `LATEST`.
Where `platformFamily` is `Windows`, ensure `platformVersion` is `1.0.0` or `LATEST`.
Repeat for each cluster and service.

## Expected Result

All Fargate services should be using platform version `1.4.0`/`LATEST` (Linux) or `1.0.0`/`LATEST` (Windows).

## Remediation

### Using AWS Console

1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Clusters`.
3. Click the name of a cluster.
4. Under `Services`, from the `Filter launch type` drop-down menu, select `FARGATE`.
5. Click the name of a service.
6. Click `Update service`.
7. Expand the `Compute configuration (advanced)` section.
8. Under `Platform version`, select `LATEST` from the drop-down menu.
9. Click `Update`.
10. Repeat steps 1-9 for each ECS cluster and Fargate service requiring remediation.

### Using AWS CLI

For each service requiring remediation, run the following command to set `platformVersion` to `LATEST`:

```
aws ecs update-service --cluster <cluster-arn> --service <service-arn> --platform-version LATEST
```

## Default Value

The platform version for Fargate services is `LATEST` by default.

## References

1. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/platform-fargate.html
2. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/list-clusters.html
3. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/list-services.html
4. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/describe-services.html

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 2.2 Ensure Authorized Software is Currently Supported | x    | x    | x    |
| v7               | 2.2 Ensure Software is Supported by Vendor            | x    | x    | x    |

## Profile

Level 1 | Automated
