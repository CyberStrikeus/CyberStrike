---
name: cis-eks-v160-4.1.7
description: "Cluster Access Manager API to streamline and enhance the management of access controls within EKS clusters (Automated)"
category: cis-eks
version: "1.6.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, rbac, service-accounts, access-manager, iam, configmap]
cis_id: "4.1.7"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.6.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.7 Cluster Access Manager API to streamline and enhance the management of access controls within EKS clusters (Automated)

## Profile Applicability

- Level 1

## Description

Amazon EKS has introduced the Cluster Access Manager API to streamline and enhance the management of access controls within EKS clusters. This new approach is now the recommended method over the traditional `aws-auth` ConfigMap for managing Role-Based Access Control (RBAC) and Service Accounts.

Key Advantages of Using the Cluster Access Manager API:

1. **Simplified Access Management:** The Cluster Access Manager API allows administrators to manage access directly through the Amazon EKS API, eliminating the need to modify the aws-auth ConfigMap manually. This reduces operational overhead and minimizes the risk of misconfigurations.
2. **Enhanced Security Controls:** With this API, administrators can assign predefined AWS-managed Kubernetes permissions, known as "access policies," to IAM principals. This provides a more secure and auditable way to manage permissions compared to manual ConfigMap edits.
3. **Improved Visibility and Auditing:** The API offers better visibility into cluster access configurations, facilitating easier auditing and compliance checks. Administrators can list and describe access entries and policies directly through the EKS API.

## Rationale

The compelling rationale for using the Cluster Access Manager API instead of the traditional aws-auth ConfigMap in Amazon EKS revolves around security, scalability, operational efficiency, and simplified management.

1. **Increased Security and Reduced Risk:**
   - Direct Management via API: The Cluster Access Manager API enables you to manage RBAC and IAM permissions directly through the EKS API rather than editing a ConfigMap. This eliminates the risk of inadvertent errors when manually modifying the `aws-auth` ConfigMap.
   - Immutable Access Entries: The API ensures that once access entries are defined, they are tightly controlled, reducing the risk of accidental overwrites or misconfigurations that can happen when editing YAML files.
   - Fine-Grained Access Control: By leveraging the new API, you can define access policies at a more granular level than the previous method. This ensures that only the necessary permissions are granted, minimizing the attack surface.

2. **Operational Efficiency and Scalability:**
   - Scalability: Managing access control through the aws-auth ConfigMap becomes increasingly challenging as the number of users and services grows. The new API scales better by allowing access management through standard AWS Identity and Access Management (IAM) tools.
   - Reduced Operational Overhead: The API simplifies the management of access controls by removing the need for manual updates to the ConfigMap, reducing the risk of human error, and automating access provisioning through Infrastructure as Code (IaC) tools like Terraform or CloudFormation.

3. **Improved Visibility, Auditing, and Compliance:**
   - Auditable and Traceable Changes: The Cluster Access Manager API integrates with AWS CloudTrail, allowing you to track who made changes to access configurations. This level of visibility is critical for organizations that need to adhere to compliance frameworks like SOC 2, GDPR, or HIPAA.
   - Centralized Management: Unlike the `aws-auth` ConfigMap, which is managed at the Kubernetes level, the new API leverages AWS IAM's centralized management and auditing capabilities, providing a unified view of access controls across your AWS environment.

4. **Faster and Safer Access Provisioning:**
   - No More Cluster Downtime: Errors in the aws-auth ConfigMap can accidentally lock out users or admins from the cluster, requiring complex recovery processes. The API-based approach is more resilient, reducing the risk of misconfigurations causing downtime.
   - Immediate Effect: Changes made via the API take effect immediately, whereas updates to the aws-auth ConfigMap may require a delay or even restarting components in some cases.

5. **Future-Proofing and Alignment with AWS Best Practices:**
   - Native Support in Kubernetes Versions: Starting from Kubernetes 1.23, the Cluster Access Manager API is fully supported and designed to replace the aws-auth ConfigMap method. This aligns with AWS's roadmap and best practices for EKS.
   - Modern Approach for Pod Identity: When combined with IAM Roles for Service Accounts (IRSA) or the new Pod Identity feature, the API supports a more dynamic and secure model for assigning permissions to pods, making it easier to implement least-privilege access.

## Impact

The shift to using the Cluster Access Manager API instead of the aws-auth ConfigMap impacts EKS RBAC and Service Accounts by simplifying access control management, reducing the risk of misconfigurations, and enhancing security. It allows for more granular, direct management of IAM permissions and Kubernetes roles, eliminating manual ConfigMap edits and reducing operational overhead. For Service Accounts, it better integrates with existing mechanisms like IAM Roles for Service Accounts (IRSA) for secure pod access to AWS resources, making it easier to enforce least-privilege principles. This transition improves scalability, auditing, and compliance, while providing a future-proof solution aligned with AWS's Kubernetes identity management roadmap.

## Audit Procedure

To check if the Cluster Access Manager API is active on your Amazon EKS cluster, you can use the following AWS CLI command:

```bash
aws eks describe-cluster --name $CLUSTER_NAME --query "cluster.accessConfig" --output json
```

Replace `$CLUSTER_NAME` with the name of your EKS cluster.

The command queries the `cluster.accessConfig` property, which indicates the authentication mode of the cluster.

**Possible Outputs:**

- If the output shows `"authenticationmode": "API"` or `"authenticationmode": "API_AND_CONFIG_MAP"`, it means the Cluster Access Manager API is enabled.
- If it only shows `"authenticationmode": "CONFIG_MAP"`, then the cluster is still using the traditional `aws-auth` ConfigMap approach.

## Remediation

Log in to the AWS Management Console.
Navigate to Amazon EKS and select your EKS cluster.
Go to the Access tab and click on "Manage Access" in the "Access Configuration section".
Under Cluster Authentication Mode for Cluster Access settings:

- Click `EKS API` to change `cluster will source authenticated IAM principals only from EKS access entry APIs`.
- Click `ConfigMap` to change `cluster will source authenticated IAM principals only from the aws-auth ConfigMap`.
- Note: `EKS API and ConfigMap` must be selected during Cluster creation and cannot be changed once the Cluster is provisioned.

## Default Value

`EKS API` is selected by default during EKS Cluster creation but can be changed during initial configuration.

## References

1. https://aws.amazon.com/blogs/containers/a-deep-dive-into-simplified-amazon-eks-access-management-controls/
2. https://www.eksworkshop.com/docs/security/cluster-access-management/understanding

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 14.7 Enforce Access Control to Data through Automated Tools                     |      |      | x    |
