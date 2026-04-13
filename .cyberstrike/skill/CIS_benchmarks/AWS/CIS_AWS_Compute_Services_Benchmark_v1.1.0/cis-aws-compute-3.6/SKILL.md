---
name: cis-aws-compute-3.6
description: "Ensure secrets are not passed as container environment variables in Amazon ECS task definitions"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, ecs, containers, task-definitions, secrets, environment-variables, credentials]
cis_id: "3.6"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-compute-3.5, cis-aws-compute-3.7]
prerequisites: []
severity_boost: {}
---

# Ensure secrets are not passed as container environment variables in Amazon ECS task definitions

## Description

Ensure that sensitive secrets, such as `AWS_ACCESS_KEY_ID`, are not passed as environment variables in Amazon ECS task definitions. Use more secure methods, such as secrets management services like AWS Secrets Manager or AWS Systems Manager Parameter Store, to inject these credentials into containers.

Note: This recommendation assumes that only the latest active revision of a task definition is in use. If older revisions are in use, apply the audit and remediation procedures to those revisions as needed.

## Rationale

Passing secrets as environment variables exposes them to potential compromise, as they can be easily accessed by any process running within the container or by unauthorized users. This practice can lead to the unintended leakage of sensitive information.

## Impact

There is some administrative overhead involved in configuring and integrating secrets management solutions.

## Audit Procedure

### Using AWS Console

1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Task definitions`.
3. Click the name of a task definition.
4. Click on the latest active revision of the task definition.
5. Click `JSON`.
6. For each element under `containerDefinitions`, ensure that the `environment` parameter does not contain `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or `ECS_ENGINE_AUTH_DATA`.
7. Repeat steps 1-6 for each task definition.

### Using AWS CLI

Run the following command to list task definitions:

```
aws ecs list-task-definitions
```

For the latest revision of a task definition, run the following command:

```
aws ecs describe-task-definition --task-definition <task-definition-arn> --query 'taskDefinition.containerDefinitions[*].environment[*].name'
```

Ensure that the command does not contain `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or `ECS_ENGINE_AUTH_DATA`.
Repeat for each task definition.

## Expected Result

No container environment variables should contain `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or `ECS_ENGINE_AUTH_DATA`.

## Remediation

### Using AWS Console

1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Task definitions`.
3. Click the name of a task definition.
4. Click on the latest active revision of the task definition.
5. Click `Create new revision`.
6. Click `Create new revision with JSON`.
7. For each element under `containerDefinitions`, in the `environment` parameter, remove any objects with a `name` matching `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or `ECS_ENGINE_AUTH_DATA`.
8. Click `Create`.
9. Repeat steps 1-8 for each task definition requiring remediation.

Note: When a task definition is updated, running tasks launched from the previous task definition remain unchanged. Updating a running task requires redeploying it with the new task definition.

### Using AWS CLI

No specific CLI remediation provided. Register a new task definition revision with secrets removed from environment variables using `aws ecs register-task-definition`.

## Default Value

By default, secrets are not present as container environment variables in task definitions.

## References

1. https://docs.aws.amazon.com/systems-manager/latest/userguide/sysman-paramstore-su-create.html
2. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html
3. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/list-task-definitions.html
4. https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ecs/describe-task-definition.html

## CIS Controls

| Controls Version | Control                                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.1 Establish and Maintain a Data Management Process                |      | x    | x    |
| v8               | 3.2 Establish and Maintain a Data Inventory                         | x    | x    | x    |
| v7               | 16.4 Encrypt or Hash all Authentication Credentials                 |      | x    | x    |
| v7               | 16.5 Encrypt Transmittal of Username and Authentication Credentials |      | x    | x    |

## Profile

Level 1 | Automated
