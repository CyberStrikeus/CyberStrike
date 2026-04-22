---
name: "T1059.009_cloud-api"
description: "Adversaries may abuse cloud APIs to execute malicious commands."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1059.009
  - execution
  - iaas
  - identity-provider
  - office-suite
  - saas
  - sub-technique
technique_id: "T1059.009"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - IaaS
  - Identity Provider
  - Office Suite
  - SaaS
mitre_url: "https://attack.mitre.org/techniques/T1059/009"
tech_stack:
  - cloud
  - identity
  - office
  - saas
cwe_ids:
  - CWE-94
chains_with:
  - T1059
  - T1059.001
  - T1059.002
  - T1059.003
  - T1059.004
  - T1059.005
  - T1059.006
  - T1059.007
  - T1059.008
  - T1059.010
  - T1059.011
  - T1059.012
  - T1059.013
prerequisites:
  - T1059
severity_boost:
  T1059: "Chain with T1059 for deeper attack path"
  T1059.001: "Chain with T1059.001 for deeper attack path"
  T1059.002: "Chain with T1059.002 for deeper attack path"
---

# T1059.009 Cloud API

> **Sub-technique of:** T1059

## High-Level Description

Adversaries may abuse cloud APIs to execute malicious commands. APIs available in cloud environments provide various functionalities and are a feature-rich method for programmatic access to nearly all aspects of a tenant. These APIs may be utilized through various methods such as command line interpreters (CLIs), in-browser Cloud Shells, PowerShell modules like Azure for PowerShell, or software developer kits (SDKs) available for languages such as Python.

Cloud API functionality may allow for administrative access across all major services in a tenant such as compute, storage, identity and access management (IAM), networking, and security policies.

With proper permissions (often via use of credentials such as Application Access Token and Web Session Cookie), adversaries may abuse cloud APIs to invoke various functions that execute malicious actions. For example, CLI and PowerShell functionality may be accessed through binaries installed on cloud-hosted or on-premises hosts or accessed through a browser-based cloud shell offered by many cloud platforms (such as AWS, Azure, and GCP). These cloud shells are often a packaged unified environment to use CLI and/or scripting modules hosted as a container in the cloud environment.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** IaaS, Identity Provider, Office Suite, SaaS

## What to Check

- [ ] Identify if Cloud API technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Cloud API
- [ ] Check Identity Provider systems for indicators of Cloud API
- [ ] Check Office Suite systems for indicators of Cloud API
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cloud API by examining the target platforms (IaaS, Identity Provider, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1059.009 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1038 Execution Prevention

Use application control where appropriate to block use of PowerShell CmdLets or other host based resources to access cloud API resources.

### M1026 Privileged Account Management

Use of proper Identity and Access Management (IAM) with Role Based Access Control (RBAC) policies to limit actions administrators can perform and provide a history of administrative actions to detect unauthorized use and abuse.

## Detection

### Behavioral Detection of Malicious Cloud API Scripting

## Risk Assessment

| Finding                        | Severity | Impact    |
| ------------------------------ | -------- | --------- |
| Cloud API technique applicable | High     | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Microsoft - Azure PowerShell](https://github.com/Azure/azure-powershell)
- [Atomic Red Team - T1059.009](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1059.009)
- [MITRE ATT&CK - T1059.009](https://attack.mitre.org/techniques/T1059/009)
