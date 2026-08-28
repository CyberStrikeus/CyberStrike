---
name: cis-aws-compute-3.4
description: "Ensure Amazon ECS task definitions do not have 'privileged' set to 'true'"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ecs, containers, task-definitions, privileged, isolation]
cis_id: "3.4"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-3.1, cis-aws-compute-3.3, cis-aws-compute-3.5]
prerequisites: []
severity_boost: {}
---

# Ensure Amazon ECS task definitions do not have 'privileged' set to 'true'

## Description

Ensure that Amazon ECS task definitions do not grant privileged access to the host container instance.

Note: This recommendation assumes that only the latest active revision of a task definition is in use. If older revisions are in use, apply the audit and remediation procedures to those revisions as needed.

## Rationale

Restricting privileged access enhances security of the host container instance by maintaining isolation and reducing the risk of privilege escalation.

## Impact

There may be some administrative effort required to ensure Amazon ECS applications function as expected without privileged access.

## Audit Procedure

### Using AWS Console

1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Task definitions`.
3. Click the name of a task definition.
4. Click on the latest active revision of the task definition.
5. Click `JSON`.
6. For each element under `containerDefinitions`, ensure that `privileged` is set to `false` or is absent.
7. Repeat steps 1-6 for each task definition.

### Using AWS CLI

Run the following command to list task definitions:

```
aws ecs list-task-definitions
```

For the latest revision of a task definition, run the following command:

```
aws ecs describe-task-definition --task-definition <task-definition-arn> --query 'taskDefinition.containerDefinitions[*].privileged'
```

Ensure that the command does not return `true`.
Repeat for each task definition.

## Expected Result

The `privileged` parameter should be `false` or absent for all containers in all task definitions.

## Remediation

### Using AWS Console

1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Task definitions`.
3. Click the name of a task definition.
4. Click on the latest active revision of the task definition.
5. Click `Create new revision`.
6. Click `Create new revision with JSON`.
7. For each element under `containerDefinitions`, set `privileged` to `false`, or remove `"privileged": true`.
8. Click `Create`.
9. Repeat steps 1-8 for each task definition requiring remediation.

Note: When a task definition is updated, running tasks launched from the previous task definition remain unchanged. Updating a running task requires redeploying it with the new task definition.

### Using AWS CLI

No specific CLI remediation provided. Register a new task definition revision with corrected `privileged` setting using `aws ecs register-task-definition`.

## Default Value

By default, `privileged` is set to `false`.

## References

1. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html
2. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/list-task-definitions.html
3. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/describe-task-definition.html

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | x    | x    | x    |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts                   | x    | x    | x    |

## Profile

Level 1 | Automated
