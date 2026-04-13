---
name: cis-aws-compute-11.1
description: "Ensure customer-managed keys are used to encrypt AWS Fargate ephemeral storage data for Amazon ECS"
category: cis-compute
version: "1.1.0"
author: cyberstrike-official
tags: [cis, aws, compute, fargate, ecs, kms, encryption, ephemeral-storage]
cis_id: "11.1"
cis_benchmark: "CIS AWS Compute Services Benchmark v1.1.0"
tech_stack: [aws]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 11.1 Ensure customer-managed keys are used to encrypt AWS Fargate ephemeral storage data for Amazon ECS (Automated)

## Description

Use customer-managed AWS KMS keys to encrypt AWS Fargate ephemeral storage data for on Amazon ECS, ensuring that sensitive data remains protected during task execution.

## Rationale

Customer-managed KMS keys offer enhanced control over encryption, including key rotation, access policies, and audit trails.

## Impact

There are costs and configuration overhead associated with setting up and managing customer-managed keys.

## Audit Procedure

### Using AWS Console

1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Clusters`.
3. Click the name of a cluster.
4. Ensure that `Fargate ephemeral storage` is not set to `-`.
5. Repeat steps 1-4 for each ECS cluster.

### Using AWS CLI

Run the following command to list clusters:

```bash
aws ecs list-clusters
```

Run the following command to view the Fargate ephemeral storage KMS key ID configured for a cluster:

```bash
aws ecs describe-clusters --clusters <cluster-arn> --include CONFIGURATIONS --query 'clusters[*].configuration.managedStorageConfiguration.fargateEphemeralStorageKmsKeyId'
```

Ensure the command returns a customer-managed KMS key ARN.
Repeat for each cluster.

## Expected Result

Each ECS cluster returns a valid customer-managed KMS key ARN for the Fargate ephemeral storage configuration, rather than `-` or empty.

## Remediation

### Using AWS Console

1. Login to the ECS console using https://console.aws.amazon.com/ecs/.
2. In the left panel, click `Clusters`.
3. Click the name of a cluster.
4. Click `Update cluster`.
5. Expand the `Encryption` section.
6. Under `Fargate ephemeral storage`, select a customer-managed KMS key.
   Note: Ensure the KMS key has appropriate Fargate service permissions.
7. Click `Update`.
8. Repeat steps 1-7 for each ECS cluster requiring remediation.

### Using AWS CLI

N/A - Remediation is console-based for this control.

## Default Value

AWS Fargate ephemeral storage data is encrypted by default.

## References

1. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-storage-encryption.html
2. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-create-storage-key.html
3. https://awscli.amazonaws.com/v2/documentation/api/2.0.33/reference/ecs/list-clusters.html
4. https://awscli.amazonaws.com/v2/documentation/api/2.0.33/reference/ecs/describe-clusters.html

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest        |      | X    | X    |
| v7               | 14.8 Encrypt Sensitive Information at Rest |      |      | X    |

## Profile

Level 2 | Automated
