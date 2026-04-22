---
name: cis-oke-v150-5.1.3
description: "Minimize cluster access to read-only for Oracle Cloud Infrastructure Container Registry (OCIR) (Manual)"
category: cis-oke
version: "1.5.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, managed-services, image-registry, image-scanning, ocir]
cis_id: "5.1.3"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.5.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.3 Minimize cluster access to read-only for Oracle Cloud Infrastructure Container Registry (OCIR) (Manual)

## Profile Applicability

- Level 1

## Description

Configure the Cluster Service Account to only allow read-only access to OKE.

## Rationale

The Cluster Service Account does not require administrative access to OCR, only requiring pull access to containers to deploy onto OKE. Restricting permissions follows the principles of least privilege and prevents credentials from being abused beyond the required role.

## Impact

A separate dedicated service account may be required for use by build servers and other robot users pushing or managing container images.

## Audit

Review Oracle OCS worker node IAM role IAM Policy Permissions to verify that they are set and the minimum required level.

If utilizing a 3rd party tool to scan images utilize the minimum required permission level required to interact with the cluster - generally this should be read-only.

## Remediation

To access a cluster using kubectl, you have to set up a Kubernetes configuration file (commonly known as a 'kubeconfig' file) for the cluster. The kubeconfig file (by default named config and stored in the $HOME/.kube directory) provides the necessary details to access the cluster. Having set up the kubeconfig file, you can start using kubectl to manage the cluster.

The steps to follow when setting up the kubeconfig file depend on how you want to access the cluster:

- To access the cluster using kubectl in Cloud Shell, run an Oracle Cloud Infrastructure CLI command in the Cloud Shell window to set up the kubeconfig file.
- To access the cluster using a local installation of kubectl:
  1. Generate an API signing key pair (if you don't already have one).
  2. Upload the public key of the API signing key pair.
  3. Install and configure the Oracle Cloud Infrastructure CLI.
  4. Set up the kubeconfig file.

See [Setting Up Local Access to Clusters](https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Tasks/contengdownloadkubeconfigfile.htm).

## Default Value

The default permissions for the cluster Service account is dependent on the initial configuration and IAM policy.

## References

1. [https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Tasks/contengdownloadkubeconfigfile.htm](https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Tasks/contengdownloadkubeconfigfile.htm)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts - Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | x | x | x |
| v7 | 14 Controlled Access Based on the Need to Know - Controlled Access Based on the Need to Know | | | |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1552 | TA0006 | M1026 |

## Profile

Level 1 - OKE
