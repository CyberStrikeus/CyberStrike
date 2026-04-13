---
name: cis-aws-compute-3.5
description: "Ensure 'readonlyRootFilesystem' is set to 'true' for Amazon ECS task definitions"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ecs, containers, task-definitions, filesystem, read-only]
cis_id: "3.5"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-3.4, cis-aws-compute-3.6]
prerequisites: []
severity_boost: {}
---

# Ensure 'readonlyRootFilesystem' is set to 'true' for Amazon ECS task definitions

## Description
Ensure the `readonlyRootFilesystem` parameter is enabled in Amazon ECS task definitions to restrict write access to the filesystem.

Note: This recommendation assumes that only the latest active revision of a task definition is in use. If older revisions are in use, apply the audit and remediation procedures to those revisions as needed.

## Rationale
Enabling `readonlyRootFilesystem` minimizes security risks by ensuring the container's filesystem cannot be altered unless specific read-write permissions are granted.

## Impact
There may be some administrative effort required to ensure Amazon ECS applications function as expected with a read-only root filesystem. Applications that need to write to the filesystem will require volume mounts or tmpfs mounts.

## Audit Procedure

### Using AWS Console
1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Task definitions`.
3. Click the name of a task definition.
4. Click on the latest active revision of the task definition.
5. Click `JSON`.
6. For each element under `containerDefinitions`, ensure `readonlyRootFilesystem` is set to `true`.
7. Repeat steps 1-6 for each task definition.

### Using AWS CLI
Run the following command to list task definitions:
```
aws ecs list-task-definitions
```

For the latest revision of a task definition, run the following command:
```
aws ecs describe-task-definition --task-definition <task-definition-arn> --query 'taskDefinition.containerDefinitions[*].readonlyRootFilesystem'
```

Ensure that the command returns only `true`.
Repeat for each task definition.

## Expected Result
The `readonlyRootFilesystem` parameter should be set to `true` for all containers in all task definitions.

## Remediation

### Using AWS Console
1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Task definitions`.
3. Click the name of a task definition.
4. Click on the latest active revision of the task definition.
5. Click `Create new revision`.
6. Click `Create new revision with JSON`.
7. For each element under `containerDefinitions`, set `readonlyRootFilesystem` to `true`.
8. Click Create.
9. Repeat steps 1-8 for each task definition requiring remediation.

Note: When a task definition is updated, running tasks launched from the previous task definition remain unchanged. Updating a running task requires redeploying it with the new task definition.

### Using AWS CLI
No specific CLI remediation provided. Register a new task definition revision with corrected `readonlyRootFilesystem` setting using `aws ecs register-task-definition`.

## Default Value
By default, `readonlyRootFilesystem` is set to `false`.

## References
1. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html
2. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/list-task-definitions.html
3. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/describe-task-definition.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process | x | x | x |
| v7 | 5.1 Establish Secure Configurations | x | x | x |

## Profile
Level 1 | Automated
