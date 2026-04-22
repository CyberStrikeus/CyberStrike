---
name: "T1069.003_cloud-groups"
description: "Adversaries may attempt to find cloud groups and permission settings."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1069.003
  - discovery
  - saas
  - iaas
  - office-suite
  - identity-provider
  - sub-technique
technique_id: "T1069.003"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - SaaS
  - IaaS
  - Office Suite
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1069/003"
tech_stack:
  - saas
  - cloud
  - office
  - identity
cwe_ids:
  - CWE-200
chains_with:
  - T1069
  - T1069.001
  - T1069.002
prerequisites:
  - T1069
severity_boost:
  T1069: "Chain with T1069 for deeper attack path"
  T1069.001: "Chain with T1069.001 for deeper attack path"
  T1069.002: "Chain with T1069.002 for deeper attack path"
---

# T1069.003 Cloud Groups

> **Sub-technique of:** T1069

## High-Level Description

Adversaries may attempt to find cloud groups and permission settings. The knowledge of cloud permission groups can help adversaries determine the particular roles of users and groups within an environment, as well as which users are associated with a particular group.

With authenticated access there are several tools that can be used to find permissions groups. The <code>Get-MsolRole</code> PowerShell cmdlet can be used to obtain roles and permissions groups for Exchange and Office 365 accounts .

Azure CLI (AZ CLI) and the Google Cloud Identity Provider API also provide interfaces to obtain permissions groups. The command <code>az ad user get-member-groups</code> will list groups associated to a user account for Azure while the API endpoint <code>GET https://cloudidentity.googleapis.com/v1/groups</code> lists group resources available to a user for Google. In AWS, the commands `ListRolePolicies` and `ListAttachedRolePolicies` allow users to enumerate the policies attached to a role.

Adversaries may attempt to list ACLs for objects to determine the owner and other accounts with access to the object, for example, via the AWS <code>GetBucketAcl</code> API . Using this information an adversary can target accounts with permissions to a given object or leverage accounts they have already compromised to access the object.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** SaaS, IaaS, Office Suite, Identity Provider

## What to Check

- [ ] Identify if Cloud Groups technique is applicable to target environment
- [ ] Check SaaS systems for indicators of Cloud Groups
- [ ] Check IaaS systems for indicators of Cloud Groups
- [ ] Check Office Suite systems for indicators of Cloud Groups
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cloud Groups by examining the target platforms (SaaS, IaaS, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1069.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Behavioral Detection of Cloud Group Enumeration via API and CLI Access

## Risk Assessment

| Finding                           | Severity | Impact    |
| --------------------------------- | -------- | --------- |
| Cloud Groups technique applicable | High     | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [AWS Get Bucket ACL](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetBucketAcl.html)
- [Palo Alto Unit 42 Compromised Cloud Compute Credentials 2022](https://unit42.paloaltonetworks.com/compromised-cloud-compute-credentials/)
- [Black Hills Red Teaming MS AD Azure, 2018](https://www.blackhillsinfosec.com/red-teaming-microsoft-part-1-active-directory-leaks-via-azure/)
- [Google Cloud Identity API Documentation](https://cloud.google.com/identity/docs/reference/rest)
- [Microsoft AZ CLI](https://docs.microsoft.com/en-us/cli/azure/ad/user?view=azure-cli-latest)
- [Microsoft Msolrole](https://docs.microsoft.com/en-us/powershell/module/msonline/get-msolrole?view=azureadps-1.0)
- [GitHub Raindance](https://github.com/True-Demon/raindance)
- [Atomic Red Team - T1069.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1069.003)
- [MITRE ATT&CK - T1069.003](https://attack.mitre.org/techniques/T1069/003)
