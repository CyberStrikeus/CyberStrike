---
name: cis-eks-v180-5.1.4
description: "Minimize Container Registries to only those approved (Manual)"
category: cis-eks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, ecr, container-registry, image-policy, supply-chain]
cis_id: "5.1.4"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.8.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.4 Minimize Container Registries to only those approved (Manual)

## Profile Applicability

- Level 1

## Description

Use approved container registries.

## Rationale

Allowing unrestricted access to external container registries provides the opportunity for malicious or unapproved containers to be deployed into the cluster. Allowlisting only approved container registries reduces this risk.

## Impact

All container images to be deployed to the cluster must be hosted within an approved container image registry.

## Audit Procedure

Review the container registries in use and ensure they are approved by organizational policy. Verify that admission control policies (such as OPA Gatekeeper or Kyverno) are configured to restrict images to approved registries only.

## Remediation

To minimize AWS ECR container registries to only those approved, you can follow these steps:

1. **Define your approval criteria:** Determine the criteria that containers must meet to be considered approved. This can include factors such as security, compliance, compatibility, and other requirements.
2. **Identify all existing ECR registries:** Identify all ECR registries that are currently being used in your organization.
3. **Evaluate ECR registries against approval criteria:** Evaluate each ECR registry against your approval criteria to determine whether it should be approved or not. This can be done by reviewing the registry settings and configuration, as well as conducting security assessments and vulnerability scans.
4. **Establish policies and procedures:** Establish policies and procedures that outline how ECR registries will be approved, maintained, and monitored. This should include guidelines for developers to follow when selecting a registry for their container images.
5. **Implement access controls:** Implement access controls to ensure that only approved ECR registries are used to store and distribute container images. This can be done by setting up IAM policies and roles that restrict access to unapproved registries or create a whitelist of approved registries.
6. **Monitor and review:** Continuously monitor and review the use of ECR registries to ensure that they continue to meet your approval criteria. This can include regularly reviewing access logs, scanning for vulnerabilities, and conducting periodic audits.

By following these steps, you can minimize AWS ECR container registries to only those approved, which can help to improve security, reduce complexity, and streamline container management in your organization. Additionally, AWS provides several tools and services that can help you manage your ECR registries, such as AWS Config, AWS CloudFormation, and AWS Identity and Access Management (IAM).

## Default Value

Container registries are not restricted by default and Kubernetes assumes your default CR is Docker Hub.

## References

1. https://aws.amazon.com/blogs/opensource/using-open-policy-agent-on-amazon-eks/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 2.5 Allowlist Authorized Software | | X | X |
| v7 | 5.3 Securely Store Master Images | | X | X |
| v7 | 13.4 Only Allow Access to Authorized Cloud Storage or Email Providers | | X | X |
