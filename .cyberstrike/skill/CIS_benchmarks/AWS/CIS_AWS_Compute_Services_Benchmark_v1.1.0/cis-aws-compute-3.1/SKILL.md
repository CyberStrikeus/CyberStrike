---
name: cis-aws-compute-3.1
description: "Ensure Amazon ECS task definitions using 'host' network mode do not allow privileged or root user access to the host"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ecs, containers, task-definitions, networking, privilege-escalation, host-network]
cis_id: "3.1"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-3.3, cis-aws-compute-3.4]
prerequisites: []
severity_boost: {}
---

# Ensure Amazon ECS task definitions using 'host' network mode do not allow privileged or root user access to the host

## Description
Ensure that Amazon ECS task definitions using `host` network mode do not allow privileged or root user access. This protects the host container instance from unauthorized access and privilege escalation.

Note: This recommendation assumes that only the latest active revision of a task definition is in use. If older revisions are in use, apply the audit and remediation procedures to those revisions as needed.

## Rationale
Combining host networking mode with privileged or root user access significantly increases the risk of container breakout, where a compromised container can gain control of the host system.

## Impact
There may be some administrative effort required to ensure Amazon ECS applications function as expected without privileged or root user access.

## Audit Procedure

### Using AWS Console
1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Task definitions`.
3. Click the name of a task definition.
4. Click on the latest active revision of the task definition.
5. If `Network mode` is set to `host`, click `JSON`.
6. For each element under `containerDefinitions`, ensure that `privileged` is set to `false` or is absent, and ensure that `user` is not set to `root` or is absent.
7. Repeat steps 1-6 for each task definition.

### Using AWS CLI
Run the following command to list task definitions:
```
aws ecs list-task-definitions
```

For the latest revision of a task definition, run the following command:
```
aws ecs describe-task-definition --task-definition <task-definition-arn>
```

If `networkMode` is set to `host`, ensure that for each element under `containerDefinitions`, `privileged` is set to `false` or is absent, and ensure that `user` is not set to `root` or is absent.
Repeat for each task definition.

## Expected Result
For task definitions using `host` network mode, `privileged` should be `false` or absent, and `user` should not be `root` or should be absent in all `containerDefinitions`.

## Remediation

### Using AWS Console
1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Task definitions`.
3. Click the name of a task definition.
4. Click on the latest active revision of the task definition.
5. Click `Create new revision`.
6. Click `Create new revision with JSON`.
7. For each element under `containerDefinitions`, set `privileged` to `false`, or remove `"privileged": true`.
8. For each element under `containerDefinitions`, set `user` to an appropriate non-root user, or remove `"user": "root"`.
9. Click `Create`.
10. Repeat steps 1-9 for each task definition requiring remediation.

Note: When a task definition is updated, running tasks launched from the previous task definition remain unchanged. Updating a running task requires redeploying it with the new task definition.

### Using AWS CLI
No specific CLI remediation provided. Use the console steps above or register a new task definition revision with corrected settings using `aws ecs register-task-definition`.

## Default Value
When creating a task definition with `host` network mode, the `privileged` and `user` parameters are unset by default.

## References
1. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html
2. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html
3. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/describe-task-definition.html

## Additional Information
- AWS recommends using the `awsvpc` network mode unless you have a specific need to use a different network mode.
- The `privileged` parameter is not supported for Windows containers or tasks using the Fargate launch type.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | x | x | x |
| v7 | 4.3 Ensure the Use of Dedicated Administrative Accounts | x | x | x |

## Profile
Level 1 | Automated
