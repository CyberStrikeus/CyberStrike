---
name: cis-aws-compute-3.13
description: "Ensure only trusted images are used with Amazon ECS"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ecs, containers, task-definitions, trusted-images, supply-chain, container-security]
cis_id: "3.13"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-3.4, cis-aws-compute-3.5, cis-aws-compute-3.6]
prerequisites: []
severity_boost: {}
---

# Ensure only trusted images are used with Amazon ECS

## Description

Ensure that only trusted container images from verified sources or private repositories are used with Amazon ECS to maintain the integrity and security of workloads.

Note: This recommendation assumes that only the latest active revision of a task definition is in use. If older revisions are in use, apply the audit and remediation procedures to those revisions as needed.

## Rationale

Using trusted images reduces the risk of vulnerabilities, malware, or unauthorized modifications compromising ECS tasks.

## Impact

Minor costs for scanning, storage, and administrative effort to enforce policies and manage approved images.

## Audit Procedure

### Using AWS Console

1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Task definitions`.
3. Click the name of a task definition.
4. Click on the latest active revision of the task definition.
5. Click `JSON`.
6. For each element under `containerDefinitions`, ensure that `image` is set to an image trusted by your organization.
7. Repeat steps 1-6 for each task definition.

### Using AWS CLI

Run the following command to list task definitions:

```
aws ecs list-task-definitions
```

For the latest revision of a task definition, run the following command:

```
aws ecs describe-task-definition --task-definition <task-definition-arn> --query 'taskDefinition.containerDefinitions[*].image'
```

Ensure that the command returns only images trusted by your organization.
Repeat for each task definition.

## Expected Result

All container images referenced in task definitions should be from trusted sources (e.g., private ECR repositories, verified Docker Hub images, or organization-approved registries).

## Remediation

### Using AWS Console

1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Task definitions`.
3. Click the name of a task definition.
4. Click on the latest active revision of the task definition.
5. Click `Create new revision`.
6. Click `Create new revision with JSON`.
7. For each element under `containerDefinitions`, set `image` to an appropriate image trusted by your organization.
8. Repeat steps 1-7 for each task definition requiring remediation.

Note: When a task definition is updated, running tasks launched from the previous task definition remain unchanged. Updating a running task requires redeploying it with the new task definition.

### Using AWS CLI

No specific CLI remediation provided. Register a new task definition revision with trusted images using `aws ecs register-task-definition`.

## Default Value

No default value. The image must be specified when creating a task definition.

## References

1. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/container-considerations.html
2. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/list-task-definitions.html
3. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/describe-task-definition.html

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 2.2 Ensure Authorized Software is Currently Supported | x    | x    | x    |
| v7               | 2.2 Ensure Software is Supported by Vendor            | x    | x    | x    |

## Profile

Level 1 | Automated
