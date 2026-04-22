---
name: cis-eks-v160-5.3.1
description: "Ensure Kubernetes Secrets are encrypted using Customer Master Keys (CMKs) managed in AWS KMS (Manual)"
category: cis-eks
version: "1.6.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, kms, encryption, secrets, etcd]
cis_id: "5.3.1"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.6.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.1 Ensure Kubernetes Secrets are encrypted using Customer Master Keys (CMKs) managed in AWS KMS (Manual)

## Profile Applicability

- Level 1

## Description

Encrypt Kubernetes secrets, stored in etcd, using secrets encryption feature during Amazon EKS cluster creation.

## Rationale

Kubernetes can store secrets that pods can access via a mounted volume. Today, Kubernetes secrets are stored with Base64 encoding, but encrypting is the recommended approach. Amazon EKS clusters version 1.13 and higher support the capability of encrypting your Kubernetes secrets using AWS Key Management Service (KMS) Customer Managed Keys (CMK). The only requirement is to enable the encryption provider support during EKS cluster creation.

Use AWS Key Management Service (KMS) keys to provide envelope encryption of Kubernetes secrets stored in Amazon EKS. Implementing envelope encryption is considered a security best practice for applications that store sensitive data and is part of a defense in depth security strategy.

Application-layer Secrets Encryption provides an additional layer of security for sensitive data, such as user defined Secrets and Secrets required for the operation of the cluster, such as service account keys, which are all stored in etcd.

Using this functionality, you can use a key, that you manage in AWS KMS, to encrypt data at the application layer. This protects against attackers in the event that they manage to gain access to etcd.

## Audit Procedure

For Amazon EKS clusters with Secrets Encryption enabled, run the AWS CLI command:

```bash
aws eks describe-cluster --name=<cluster-name>
```

From the output of the command, search if the following configuration exists with a valid AWS `keyArn`:

```json
"encryptionConfig": [
    {
        "provider": {
            "keyArn": "string"
        },
        "resources": [ "string" ]
    }
],
```

## Remediation

This process can only be performed during Cluster Creation. Enable 'Secrets Encryption' during Amazon EKS cluster creation as described in the links within the 'References' section.

## Default Value

By default secrets created using the Kubernetes API are stored in tmpfs and are encrypted at rest.

## References

1. https://aws.amazon.com/about-aws/whats-new/2020/03/amazon-eks-adds-envelope-encryption-for-secrets-with-aws-kms/
2. https://docs.aws.amazon.com/eks/latest/APIReference/API_DescribeCluster.html

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest        |      | X    | X    |
| v7               | 14.8 Encrypt Sensitive Information at Rest |      |      | X    |
