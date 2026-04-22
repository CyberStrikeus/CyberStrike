---
name: cis-eks-v160-5.1.2
description: "Minimize user access to Amazon ECR (Manual)"
category: cis-eks
version: "1.6.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, ecr, iam, access-control, least-privilege]
cis_id: "5.1.2"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.6.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.2 Minimize user access to Amazon ECR (Manual)

## Profile Applicability

- Level 1

## Description

Restrict user access to Amazon ECR, limiting interaction with build images to only authorized personnel and service accounts.

## Rationale

Weak access control to Amazon ECR may allow malicious users to replace built images with vulnerable containers.

## Impact

Care should be taken not to remove access to Amazon ECR for accounts that require this for their operation.

## Audit Procedure

Review IAM policies associated with Amazon ECR to ensure that access is restricted to only authorized users and service accounts.

## Remediation

Before you use IAM to manage access to Amazon ECR, you should understand what IAM features are available to use with Amazon ECR. To get a high-level view of how Amazon ECR and other AWS services work with IAM, see AWS Services That Work with IAM in the IAM User Guide.

Topics:

- Amazon ECR Identity-Based Policies
- Amazon ECR Resource-Based Policies
- Authorization Based on Amazon ECR Tags
- Amazon ECR IAM Roles

### Amazon ECR Identity-Based Policies

With IAM identity-based policies, you can specify allowed or denied actions and resources as well as the conditions under which actions are allowed or denied. Amazon ECR supports specific actions, resources, and condition keys.

**Actions:** The Action element of an IAM identity-based policy describes the specific action or actions that will be allowed or denied by the policy. Policy actions usually have the same name as the associated AWS API operation. The action is used in a policy to grant permissions to perform the associated operation.

Policy actions in Amazon ECR use the following prefix before the action: `ecr:`. For example, to grant someone permission to create an Amazon ECR repository with the Amazon ECR CreateRepository API operation, you include the `ecr:CreateRepository` action in their policy.

To specify multiple actions in a single statement, separate them with commas as follows:

```json
"Action": [ "ecr:action1", "ecr:action2" ]
```

You can specify multiple actions using wildcards (\*). For example, to specify all actions that begin with the word Describe, include the following action:

```json
"Action": "ecr:Describe*"
```

**Resources:** The Resource element specifies the object or objects to which the action applies. Statements must include either a Resource or a NotResource element. You specify a resource using an ARN or using the wildcard (\*) to indicate that the statement applies to all resources.

An Amazon ECR repository resource has the following ARN:

```
arn:${Partition}:ecr:${Region}:${Account}:repository/${Repository-name}
```

For example, to specify the my-repo repository in the us-east-1 Region in your statement, use the following ARN:

```json
"Resource": "arn:aws:ecr:us-east-1:123456789012:repository/my-repo"
```

To specify all repositories that belong to a specific account, use the wildcard (\*):

```json
"Resource": "arn:aws:ecr:us-east-1:123456789012:repository/*"
```

**Condition Keys:** The Condition element (or Condition block) lets you specify conditions in which a statement is in effect. The Condition element is optional. You can build conditional expressions that use condition operators, such as equals or less than, to match the condition in the policy with values in the request.

Amazon ECR defines its own set of condition keys and also supports using some global condition keys. Most Amazon ECR actions support the `aws:ResourceTag` and `ecr:ResourceTag` condition keys.

## Default Value

By default, IAM policies for Amazon ECR are not restrictive.

## References

1. https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning.html#scanning-repository

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | X    | X    | X    |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts                   | X    | X    | X    |
