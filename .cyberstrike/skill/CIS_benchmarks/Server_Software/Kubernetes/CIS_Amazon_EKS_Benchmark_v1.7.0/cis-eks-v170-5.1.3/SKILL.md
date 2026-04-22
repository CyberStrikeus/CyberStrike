---
name: cis-eks-v170-5.1.3
description: "Minimize cluster access to read-only for Amazon ECR (Manual)"
category: cis-eks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, ecr, iam, least-privilege, read-only]
cis_id: "5.1.3"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.7.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.3 Minimize cluster access to read-only for Amazon ECR (Manual)

## Profile Applicability

- Level 1

## Description

Configure the Cluster Service Account with Storage Object Viewer Role to only allow read-only access to Amazon ECR.

## Rationale

The Cluster Service Account does not require administrative access to Amazon ECR, only requiring pull access to containers to deploy onto Amazon EKS. Restricting permissions follows the principles of least privilege and prevents credentials from being abused beyond the required role.

## Impact

A separate dedicated service account may be required for use by build servers and other robot users pushing or managing container images.

## Audit Procedure

Review AWS ECS worker node IAM role (NodeInstanceRole) IAM Policy Permissions to verify that they are set and the minimum required level.

If utilizing a 3rd party tool to scan images utilize the minimum required permission level required to interact with the cluster - generally this should be read-only.

## Remediation

You can use your Amazon ECR images with Amazon EKS, but you need to satisfy the following prerequisites.

The Amazon EKS worker node IAM role (NodeInstanceRole) that you use with your worker nodes must possess the following IAM policy permissions for Amazon ECR:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ecr:BatchCheckLayerAvailability",
                "ecr:BatchGetImage",
                "ecr:GetDownloadUrlForLayer",
                "ecr:GetAuthorizationToken"
            ],
            "Resource": "*"
        }
    ]
}
```

## Default Value

If you used eksctl or the AWS CloudFormation templates in Getting Started with Amazon EKS to create your cluster and worker node groups, these IAM permissions are applied to your worker node IAM role by default.

## References

1. https://docs.aws.amazon.com/AmazonECR/latest/userguide/ECR_on_EKS.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | X | X | X |
| v7 | 4.3 Ensure the Use of Dedicated Administrative Accounts | X | X | X |
