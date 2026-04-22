---
name: "T1098.006_additional-container-cluster-roles"
description: "An adversary may add additional roles or permissions to an adversary-controlled user or service account to maintain persistent access to a container orchestration system."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1098.006
  - persistence
  - privilege-escalation
  - containers
  - sub-technique
technique_id: "T1098.006"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Containers
mitre_url: "https://attack.mitre.org/techniques/T1098/006"
tech_stack:
  - containers
cwe_ids:
  - CWE-276
chains_with:
  - T1098
  - T1098.001
  - T1098.002
  - T1098.003
  - T1098.004
  - T1098.005
  - T1098.007
prerequisites:
  - T1098
severity_boost:
  T1098: "Chain with T1098 for deeper attack path"
  T1098.001: "Chain with T1098.001 for deeper attack path"
  T1098.002: "Chain with T1098.002 for deeper attack path"
---

# T1098.006 Additional Container Cluster Roles

> **Sub-technique of:** T1098

## High-Level Description

An adversary may add additional roles or permissions to an adversary-controlled user or service account to maintain persistent access to a container orchestration system. For example, an adversary with sufficient permissions may create a RoleBinding or a ClusterRoleBinding to bind a Role or ClusterRole to a Kubernetes account. Where attribute-based access control (ABAC) is in use, an adversary with sufficient permissions may modify a Kubernetes ABAC policy to give the target account additional permissions.

This account modification may immediately follow Create Account or other malicious account activity. Adversaries may also modify existing Valid Accounts that they have compromised.

Note that where container orchestration systems are deployed in cloud environments, as with Google Kubernetes Engine, Amazon Elastic Kubernetes Service, and Azure Kubernetes Service, cloud-based role-based access control (RBAC) assignments or ABAC policies can often be used in place of or in addition to local permission assignments. In these cases, this technique may be used in conjunction with Additional Cloud Roles.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Containers

## What to Check

- [ ] Identify if Additional Container Cluster Roles technique is applicable to target environment
- [ ] Check Containers systems for indicators of Additional Container Cluster Roles
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Additional Container Cluster Roles by examining the target platforms (Containers).

2. **Assess Existing Defenses**: Review whether mitigations for T1098.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1032 Multi-factor Authentication

Require multi-factor authentication for user accounts integrated into container clusters through cloud deployments or via authentication protocols such as LDAP or SAML.

### M1018 User Account Management

Ensure that low-privileged accounts do not have permissions to add permissions to accounts or to update container cluster roles.

## Detection

### Suspicious RoleBinding or ClusterRoleBinding Assignment in Kubernetes

## Risk Assessment

| Finding                                                 | Severity | Impact      |
| ------------------------------------------------------- | -------- | ----------- |
| Additional Container Cluster Roles technique applicable | Low      | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [AWS EKS IAM Roles for Service Accounts](https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html)
- [Google Cloud Kubernetes IAM](https://cloud.google.com/kubernetes-engine/docs/how-to/iam)
- [Kuberentes ABAC](https://kubernetes.io/docs/reference/access-authn-authz/abac/)
- [Kubernetes RBAC](https://kubernetes.io/docs/concepts/security/rbac-good-practices/)
- [Aquasec Kubernetes Attack 2023](https://blog.aquasec.com/leveraging-kubernetes-rbac-to-backdoor-clusters)
- [Microsoft Azure Kubernetes Service Service Accounts](https://learn.microsoft.com/en-us/azure/aks/concepts-identity)
- [Atomic Red Team - T1098.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1098.006)
- [MITRE ATT&CK - T1098.006](https://attack.mitre.org/techniques/T1098/006)
