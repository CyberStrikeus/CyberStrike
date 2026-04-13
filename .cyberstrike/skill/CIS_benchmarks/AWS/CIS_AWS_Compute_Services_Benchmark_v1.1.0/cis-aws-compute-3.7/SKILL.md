---
name: cis-aws-compute-3.7
description: "Ensure logging is configured for Amazon ECS task definitions"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ecs, containers, task-definitions, logging, monitoring]
cis_id: "3.7"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-3.9]
prerequisites: []
severity_boost: {}
---

# Ensure logging is configured for Amazon ECS task definitions

## Description
Configure logging for Amazon ECS task definitions to capture detailed application and container activity.

Note: This recommendation assumes that only the latest active revision of a task definition is in use. If older revisions are in use, apply the audit and remediation procedures to those revisions as needed.

## Rationale
Logging facilitates effective monitoring, troubleshooting, and incident response, improving security and enabling rapid threat detection.

## Impact
Logging can incur costs for storage and processing, along with initial configuration and ongoing management.

## Audit Procedure

### Using AWS Console
1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Task definitions`.
3. Click the name of a task definition.
4. Click on the latest active revision of the task definition.
5. Click `JSON`.
6. Ensure that at least one element under `containerDefinitions` has a `logConfiguration` property defined, and that the value for `logDriver` is not `null`.
7. Repeat steps 1-6 for each task definition.

### Using AWS CLI
Run the following command to list task definitions:
```
aws ecs list-task-definitions
```

For the latest revision of a task definition, run the following command:
```
aws ecs describe-task-definition --task-definition <task-definition-arn> --query 'taskDefinition.containerDefinitions[*].logConfiguration'
```

Ensure that the command returns at least one `logConfiguration` object, and that the value for `logDriver` is not `null`.
Repeat for each task definition.

## Expected Result
At least one container in each task definition should have a `logConfiguration` with a valid `logDriver` configured.

## Remediation

### Using AWS Console
1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Task definitions`.
3. Click the name of a task definition.
4. Click on the latest active revision of the task definition.
5. Click `Create new revision`.
6. Click `Create new revision` again.
7. For at least one container, under `Logging` > `Log collection`, check the box next to `Use log collection` and further configure the log collection options as needed.
8. Click Create.
9. Repeat steps 1-8 for each task definition requiring remediation.

Note: When a task definition is updated, running tasks launched from the previous task definition remain unchanged. Updating a running task requires redeploying it with the new task definition.

### Using AWS CLI
No specific CLI remediation provided. Register a new task definition revision with `logConfiguration` configured using `aws ecs register-task-definition`.

## Default Value
Logging is enabled by default when a task definition is created via the console.

## References
1. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.htm
2. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/list-task-definitions.html
3. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/describe-task-definition.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs | x | x | x |
| v7 | 6.2 Activate audit logging | x | x | x |

## Profile
Level 1 | Automated
