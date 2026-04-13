---
name: cis-aws-compute-3.10
description: "Ensure Amazon ECS services are tagged"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ecs, containers, services, tagging, asset-management, compliance]
cis_id: "3.10"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-3.11, cis-aws-compute-3.12]
prerequisites: []
severity_boost: {}
---

# Ensure Amazon ECS services are tagged

## Description
Ensure all Amazon ECS services have resource tags to facilitate asset management, tracking, and compliance.

## Rationale
Consistent tagging supports compliance and helps identify unauthorized or misconfigured resources.

## Impact
There is minimal administrative overhead associated with implementing and maintaining resource tags.

## Audit Procedure

### Using AWS Console
1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Clusters`.
3. Click the name of a cluster.
4. Under `Services`, click the name of a service.
5. Click `Tags`.
6. Ensure at least one tag is listed that does not begin with `aws:`. Tags prefixed with `aws:` are AWS-managed.
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

Run the following command to view the tags for a service:
```
aws ecs list-tags-for-resource --resource-arn <service-arn>
```

Ensure that tags are returned that do not begin with `aws:`. Tags prefixed with `aws:` are AWS-managed.
Repeat for each cluster and service.

## Expected Result
All ECS services should have at least one user-defined tag (not prefixed with `aws:`).

## Remediation

### Using AWS Console
1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Clusters`.
3. Click the name of a cluster.
4. Under `Services`, click the name of a service.
5. Click `Tags`.
6. Click `Manage tags`.
7. Click `Add tag`.
8. Provide a `Key` and optional `Value` for the tag.
9. Click `Save`.
10. Repeat steps 1-9 for each ECS cluster and service requiring remediation.

### Using AWS CLI
Use the `aws ecs tag-resource` command to add tags to a service:
```
aws ecs tag-resource --resource-arn <service-arn> --tags key=<TagKey>,value=<TagValue>
```

## Default Value
By default, Amazon ECS services are not tagged.

## References
1. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-using-tags.html
2. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/list-clusters.html
3. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/list-services.html
4. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/list-tags-for-resource.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 1.1 Establish and Maintain Detailed Enterprise Asset Inventory | x | x | x |
| v7 | 1.4 Maintain Detailed Asset Inventory | x | x | x |

## Profile
Level 1 | Automated
