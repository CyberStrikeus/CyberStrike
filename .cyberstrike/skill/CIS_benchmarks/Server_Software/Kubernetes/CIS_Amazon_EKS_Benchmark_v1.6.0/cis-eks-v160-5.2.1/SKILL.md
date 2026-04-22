---
name: cis-eks-v160-5.2.1
description: "Prefer using dedicated EKS Service Accounts (Automated)"
category: cis-eks
version: "1.6.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, iam, service-accounts, irsa, least-privilege]
cis_id: "5.2.1"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.6.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.1 Prefer using dedicated EKS Service Accounts (Automated)

## Profile Applicability

- Level 1

## Description

Kubernetes workloads should not use cluster node service accounts to authenticate to Amazon EKS APIs. Each Kubernetes workload that needs to authenticate to other AWS services using AWS IAM should be provisioned with a dedicated Service account.

## Rationale

Manual approaches for authenticating Kubernetes workloads running on Amazon EKS against AWS APIs are: storing service account keys as a Kubernetes secret (which introduces manual key rotation and potential for key compromise); or use of the underlying nodes' IAM Service account, which violates the principle of least privilege on a multi-tenanted node, when one pod needs to have access to a service, but every other pod on the node that uses the Service account does not.

## Impact

None documented.

## Audit Procedure

For each namespace in the cluster, review the rights assigned to the default service account and ensure that it has no roles or cluster roles bound to it apart from the defaults.

Additionally ensure that the `automountServiceAccountToken: false` setting is in place for each default service account.

```bash
kubectl get serviceaccounts --all-namespaces -o yaml
```

## Remediation

With IAM roles for service accounts on Amazon EKS clusters, you can associate an IAM role with a Kubernetes service account. This service account can then provide AWS permissions to the containers in any pod that uses that service account. With this feature, you no longer need to provide extended permissions to the worker node IAM role so that pods on that node can call AWS APIs.

Applications must sign their AWS API requests with AWS credentials. This feature provides a strategy for managing credentials for your applications, similar to the way that Amazon EC2 instance profiles provide credentials to Amazon EC2 instances. Instead of creating and distributing your AWS credentials to the containers or using the Amazon EC2 instance's role, you can associate an IAM role with a Kubernetes service account. The applications in the pod's containers can then use an AWS SDK or the AWS CLI to make API requests to authorized AWS services.

The IAM roles for service accounts feature provides the following benefits:

- **Least privilege** -- By using the IAM roles for service accounts feature, you no longer need to provide extended permissions to the worker node IAM role so that pods on that node can call AWS APIs. You can scope IAM permissions to a service account, and only pods that use that service account have access to those permissions. This feature also eliminates the need for third-party solutions such as kiam or kube2iam.
- **Credential isolation** -- A container can only retrieve credentials for the IAM role that is associated with the service account to which it belongs. A container never has access to credentials that are intended for another container that belongs to another pod.
- **Audit-ability** -- Access and event logging is available through CloudTrail to help ensure retrospective auditing.

To get started, see Enabling IAM roles for service accounts on your cluster. For an end-to-end walkthrough using eksctl, see Walkthrough: Updating a DaemonSet to use IAM for service accounts.

## Default Value

By default, no IAM roles are associated with Kubernetes service accounts.

## References

1. https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html
2. https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts-cni-walkthrough.html
3. https://aws.github.io/aws-eks-best-practices/security/docs/iam/#scope-the-iam-role-trust-policy-for-irsa-to-the-service-account-name

## CIS Controls

| Controls Version | Control                                                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 12.8 Establish and Maintain Dedicated Computing Resources for All Administrative Work |      |      | X    |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts                               | X    | X    | X    |
