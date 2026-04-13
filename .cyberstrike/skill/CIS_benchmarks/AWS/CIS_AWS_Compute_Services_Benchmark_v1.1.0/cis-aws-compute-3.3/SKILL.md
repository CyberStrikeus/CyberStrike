---
name: cis-aws-compute-3.3
description: "Ensure Amazon ECS task definitions do not have 'pidMode' set to 'host'"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ecs, containers, task-definitions, pid-namespace, isolation]
cis_id: "3.3"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-3.1, cis-aws-compute-3.4]
prerequisites: []
severity_boost: {}
---

# Ensure Amazon ECS task definitions do not have 'pidMode' set to 'host'

## Description
A process ID (PID) namespace isolates processes, preventing system processes from being visible to containers and allowing for PID reuse. Ensure that Amazon ECS task definitions are not configured to share a host's process namespace with their containers.

Note: This recommendation assumes that only the latest active revision of a task definition is in use. If older revisions are in use, apply the audit and remediation procedures to those revisions as needed.

## Rationale
Setting the `pidMode` parameter to `host` shares the host's PID namespace with containers, allowing them to view and interact with all host processes. This reduces isolation and may lead to unauthorized access and manipulation of host processes by malicious or compromised containers.

## Impact
There may be some administrative effort required to ensure Amazon ECS applications function as expected without host PID mode.

## Audit Procedure

### Using AWS Console
1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Task definitions`.
3. Click the name of a task definition.
4. Click on the latest active revision of the task definition.
5. Click `JSON`.
6. If the `pidMode` parameter is present, ensure it is not set to `host`.
7. Repeat steps 1-6 for each task definition.

### Using AWS CLI
Run the following command to list task definitions:
```
aws ecs list-task-definitions
```

For the latest revision of a task definition, run the following command:
```
aws ecs describe-task-definition --task-definition <task-definition-arn> --query 'taskDefinition.pidMode'
```

Ensure that the command does not return `"host"`.
Repeat for each task definition.

## Expected Result
The `pidMode` parameter should not be set to `host` for any task definition.

## Remediation

### Using AWS Console
1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Task definitions`.
3. Click the name of a task definition.
4. Click on the latest active revision of the task definition.
5. Click `Create new revision`.
6. Click `Create new revision with JSON`.
7. Set `pidMode` to `task`, or remove the `pidMode` parameter as appropriate.
8. Click `Create`.
9. Repeat steps 1-8 for each task definition requiring remediation.

Note: When a task definition is updated, running tasks launched from the previous task definition remain unchanged. Updating a running task requires redeploying it with the new task definition.

### Using AWS CLI
No specific CLI remediation provided. Register a new task definition revision with corrected `pidMode` setting using `aws ecs register-task-definition`.

## Default Value
If no value is specified, the default is a private namespace for each container.

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
