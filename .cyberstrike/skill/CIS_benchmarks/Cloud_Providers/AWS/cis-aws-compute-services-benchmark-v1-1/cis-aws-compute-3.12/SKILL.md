---
name: cis-aws-compute-3.12
description: "Ensure Amazon ECS task definitions are tagged"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ecs, containers, task-definitions, tagging, asset-management, compliance]
cis_id: "3.12"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-3.10, cis-aws-compute-3.11]
prerequisites: []
severity_boost: {}
---

# Ensure Amazon ECS task definitions are tagged

## Description

Ensure all Amazon ECS task definitions have resource tags to facilitate asset management, tracking, and compliance.

Note: This recommendation assumes that only the latest active revision of a task definition is in use. If older revisions are in use, apply the audit and remediation procedures to those revisions as needed.

## Rationale

Consistent tagging supports compliance and helps identify unauthorized or misconfigured resources.

## Impact

There is minimal administrative overhead associated with implementing and maintaining resource tags.

## Audit Procedure

### Using AWS Console

1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Task definitions`.
3. Click the name of a task definition.
4. Click on the latest active revision of the task definition.
5. Click `Tags`.
6. Ensure at least one tag is listed that does not begin with `aws:`. Tags prefixed with `aws:` are AWS-managed.
7. Repeat steps 1-6 for each ECS task definition.

### Using AWS CLI

Run the following command to list task definitions:

```
aws ecs list-task-definitions
```

For the latest revision, run the following command to view the tags:

```
aws ecs list-tags-for-resource --resource-arn <task-definition-arn>
```

Ensure that tags are returned that do not begin with `aws:`. Tags prefixed with `aws:` are AWS-managed.
Repeat for each task definition.

## Expected Result

All ECS task definitions should have at least one user-defined tag (not prefixed with `aws:`).

## Remediation

### Using AWS Console

1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Task definitions`.
3. Click the name of a task definition.
4. Click on the latest active revision of the task definition.
5. Click `Create new revision`.
6. Click `Create new revision` again.
7. Expand the `Tags` section.
8. Click `Add tag`.
9. Provide a `Key` and `Value` for the tag.
10. Click `Create`.
11. Repeat steps 1-10 for each task definition requiring remediation.

Note: When a task definition is updated, running tasks launched from the previous task definition remain unchanged. Updating a running task requires redeploying it with the new task definition.

### Using AWS CLI

Use the `aws ecs tag-resource` command to add tags to a task definition:

```
aws ecs tag-resource --resource-arn <task-definition-arn> --tags key=<TagKey>,value=<TagValue>
```

## Default Value

By default, Amazon ECS task definitions are not tagged.

## References

1. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-using-tags.html
2. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/list-task-definitions.html
3. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/list-tags-for-resource.html

## CIS Controls

| Controls Version | Control                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 1.1 Establish and Maintain Detailed Enterprise Asset Inventory | x    | x    | x    |
| v7               | 1.4 Maintain Detailed Asset Inventory                          | x    | x    | x    |

## Profile

Level 1 | Automated
