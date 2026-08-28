---
name: cis-aws-compute-3.2
description: "Ensure 'assignPublicIp' is set to 'DISABLED' for Amazon ECS services"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ecs, containers, networking, public-ip, services]
cis_id: "3.2"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-3.14]
prerequisites: []
severity_boost: {}
---

# Ensure 'assignPublicIp' is set to 'DISABLED' for Amazon ECS services

## Description

Ensure that `assignPublicIp` is set to `DISABLED` for Amazon ECS services, to restrict direct exposure of containers to the public internet.

## Rationale

Enabling public IP assignment could expose container application servers to unintended or unauthorized access.

## Impact

Disabling `assignPublicIp` introduces administrative, operational, and potential cost overhead due to the need to configure and maintain private networking and associated resources.

## Audit Procedure

### Using AWS Console

1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Clusters`.
3. Click the name of a cluster.
4. Under `Services`, click the name of a service.
5. Click `Configuration and networking`.
6. Under `Network configuration`, ensure `Auto-assign public IP` is set to `Turned off`.
7. Repeat steps 1-6 for each ECS cluster and service.

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
aws ecs describe-services --cluster <cluster-arn> --services <service-arn>
```

Under `networkConfiguration` > `awsvpcConfiguration`, ensure `assignPublicIp` is set to `DISABLED`.
Repeat for each cluster and service.

## Expected Result

`assignPublicIp` should be set to `DISABLED` under `networkConfiguration` > `awsvpcConfiguration` for all ECS services.

## Remediation

### Using AWS Console

No specific console remediation steps provided. Use the CLI remediation below.

### Using AWS CLI

For each service requiring remediation, run the following command to set `assignPublicIp` to `DISABLED`:

```
aws ecs update-service --cluster <cluster-arn> --service <service-arn> --network-configuration '{"awsvpcConfiguration":{"subnets":["<subnet-id>"],"securityGroups":["<security-group-id>"],"assignPublicIp":"DISABLED"}}'
```

## Default Value

By default, `assignPublicIp` is set to `ENABLED`.

## References

1. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/list-clusters.html
2. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/list-services.html
3. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/describe-services.html
4. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/update-service.html
5. https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_AwsVpcConfiguration.html

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | x    | x    | x    |
| v7               | 14.6 Protect Information through Access Control Lists | x    | x    | x    |

## Profile

Level 1 | Automated
