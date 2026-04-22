---
name: cis-eks-v160-5.5.1
description: "Manage Kubernetes RBAC users with AWS IAM Authenticator for Kubernetes or Upgrade to AWS CLI v1.16.156 or greater (Manual)"
category: cis-eks
version: "1.6.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, authentication, rbac, iam-authenticator, authorization]
cis_id: "5.5.1"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.6.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.5.1 Manage Kubernetes RBAC users with AWS IAM Authenticator for Kubernetes or Upgrade to AWS CLI v1.16.156 or greater (Manual)

## Profile Applicability

- Level 1

## Description

Amazon EKS uses IAM to provide authentication to your Kubernetes cluster through the AWS IAM Authenticator for Kubernetes. You can configure the stock kubectl client to work with Amazon EKS by installing the AWS IAM Authenticator for Kubernetes and modifying your kubectl configuration file to use it for authentication.

## Rationale

On- and off-boarding users is often difficult to automate and prone to error. Using a single source of truth for user permissions reduces the number of locations that an individual must be off-boarded from, and prevents users gaining unique permissions sets that increase the cost of audit.

## Impact

Users must now be assigned to the IAM group created to use this namespace and deploy applications. If they are not they will not be able to access the namespace or deploy.

## Audit Procedure

To Audit access to the namespace $NAMESPACE, assume the IAM role yourIAMRoleName for a user that you created, and then run the following command:

```bash
kubectl get role -n $NAMESPACE
```

The response lists the RBAC role that has access to this Namespace.

## Remediation

Refer to the 'Managing users or IAM roles for your cluster' in Amazon EKS documentation.

Note: If using AWS CLI version 1.16.156 or later there is no need to install the AWS IAM Authenticator anymore.

The relevant AWS CLI commands, depending on the use case, are:

```bash
aws eks update-kubeconfig
aws eks get-token
```

## Default Value

For role-based access control (RBAC), system:masters permissions are configured in the Amazon EKS control plane.

## References

1. https://docs.aws.amazon.com/eks/latest/userguide/add-user-role.html
2. https://docs.aws.amazon.com/eks/latest/userguide/add-user-role.html

## CIS Controls

| Controls Version | Control                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control  |      |      | X    |
| v7               | 16.2 Configure Centralized Point of Authentication |      | X    | X    |
