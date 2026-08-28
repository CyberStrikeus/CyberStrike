---
name: "T1555.006_cloud-secrets-management-stores"
description: "Adversaries may acquire credentials from cloud-native secret management solutions such as AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, and Terraform Vault."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1555.006
  - credential-access
  - iaas
  - sub-technique
technique_id: "T1555.006"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - IaaS
mitre_url: "https://attack.mitre.org/techniques/T1555/006"
tech_stack:
  - cloud
cwe_ids:
  - CWE-522
chains_with:
  - T1555
  - T1555.001
  - T1555.002
  - T1555.003
  - T1555.004
  - T1555.005
prerequisites:
  - T1555
severity_boost:
  T1555: "Chain with T1555 for deeper attack path"
  T1555.001: "Chain with T1555.001 for deeper attack path"
  T1555.002: "Chain with T1555.002 for deeper attack path"
---

# T1555.006 Cloud Secrets Management Stores

> **Sub-technique of:** T1555

## High-Level Description

Adversaries may acquire credentials from cloud-native secret management solutions such as AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, and Terraform Vault.

Secrets managers support the secure centralized management of passwords, API keys, and other credential material. Where secrets managers are in use, cloud services can dynamically acquire credentials via API requests rather than accessing secrets insecurely stored in plain text files or environment variables.

If an adversary is able to gain sufficient privileges in a cloud environment – for example, by obtaining the credentials of high-privileged Cloud Accounts or compromising a service that has permission to retrieve secrets – they may be able to request secrets from the secrets manager. This can be accomplished via commands such as `get-secret-value` in AWS, `gcloud secrets describe` in GCP, and `az key vault secret show` in Azure.

**Note:** this technique is distinct from Cloud Instance Metadata API in that the credentials are being directly requested from the cloud secrets manager, rather than through the medium of the instance metadata API.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** IaaS

## What to Check

- [ ] Identify if Cloud Secrets Management Stores technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Cloud Secrets Management Stores
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cloud Secrets Management Stores by examining the target platforms (IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1555.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1026 Privileged Account Management

Limit the number of cloud accounts and services with permission to query the secrets manager to only those required. Ensure that accounts and services with permissions to query the secrets manager only have access to the secrets they require.

## Detection

### Detect Unauthorized Access to Cloud Secrets Management Stores

## Risk Assessment

| Finding                                              | Severity | Impact            |
| ---------------------------------------------------- | -------- | ----------------- |
| Cloud Secrets Management Stores technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Sysdig ScarletEel 2.0 2023](https://sysdig.com/blog/scarleteel-2-0/)
- [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets.html)
- [Google Cloud Secrets](https://cloud.google.com/secret-manager/docs/view-secret-details)
- [Permiso Scattered Spider 2023](https://permiso.io/blog/lucr-3-scattered-spider-getting-saas-y-in-the-cloud)
- [Microsoft Azure Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/secrets/quick-create-cli)
- [Atomic Red Team - T1555.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1555.006)
- [MITRE ATT&CK - T1555.006](https://attack.mitre.org/techniques/T1555/006)
