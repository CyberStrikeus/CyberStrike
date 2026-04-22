---
name: "T1619_cloud-storage-object-discovery"
description: "Adversaries may enumerate objects in cloud storage infrastructure."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1619
  - discovery
  - iaas
technique_id: "T1619"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - IaaS
mitre_url: "https://attack.mitre.org/techniques/T1619"
tech_stack:
  - cloud
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1619 Cloud Storage Object Discovery

## High-Level Description

Adversaries may enumerate objects in cloud storage infrastructure. Adversaries may use this information during automated discovery to shape follow-on behaviors, including requesting all or specific objects from cloud storage. Similar to File and Directory Discovery on a local host, after identifying available storage services (i.e. Cloud Infrastructure Discovery) adversaries may access the contents/objects stored in cloud infrastructure.

Cloud service providers offer APIs allowing users to enumerate objects stored within cloud storage. Examples include ListObjectsV2 in AWS and List Blobs in Azure .

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** IaaS

## What to Check

- [ ] Identify if Cloud Storage Object Discovery technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Cloud Storage Object Discovery
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cloud Storage Object Discovery by examining the target platforms (IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1619 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management
Restrict granting of permissions related to listing objects in cloud storage to necessary accounts.


## Detection

### Detection Strategy for Cloud Storage Object Discovery


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Cloud Storage Object Discovery technique applicable | Medium | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [ListObjectsV2](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html)
- [List Blobs](https://docs.microsoft.com/en-us/rest/api/storageservices/list-blobs)
- [Atomic Red Team - T1619](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1619)
- [MITRE ATT&CK - T1619](https://attack.mitre.org/techniques/T1619)
