---
name: "T1525_implant-internal-image"
description: "Adversaries may implant cloud or container images with malicious code to establish persistence after gaining access to an environment."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1525
  - persistence
  - iaas
  - containers
technique_id: "T1525"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - IaaS
  - Containers
mitre_url: "https://attack.mitre.org/techniques/T1525"
tech_stack:
  - cloud
  - containers
cwe_ids:
  - CWE-276
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1525 Implant Internal Image

## High-Level Description

Adversaries may implant cloud or container images with malicious code to establish persistence after gaining access to an environment. Amazon Web Services (AWS) Amazon Machine Images (AMIs), Google Cloud Platform (GCP) Images, and Azure Images as well as popular container runtimes such as Docker can be implanted or backdoored. Unlike Upload Malware, this technique focuses on adversaries implanting an image in a registry within a victim’s environment. Depending on how the infrastructure is provisioned, this could provide persistent access if the infrastructure provisioning tool is instructed to always use the latest image.

A tool has been developed to facilitate planting backdoors in cloud container images. If an adversary has access to a compromised AWS instance, and permissions to list the available container images, they may implant a backdoor such as a Web Shell.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** IaaS, Containers

## What to Check

- [ ] Identify if Implant Internal Image technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Implant Internal Image
- [ ] Check Containers systems for indicators of Implant Internal Image
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Implant Internal Image by examining the target platforms (IaaS, Containers).

2. **Assess Existing Defenses**: Review whether mitigations for T1525 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1045 Code Signing

Several cloud service providers support content trust models that require container images be signed by trusted sources.

### M1026 Privileged Account Management

Limit permissions associated with creating and modifying platform images or containers based on the principle of least privilege.

### M1047 Audit

Periodically check the integrity of images and containers used in cloud deployments to ensure they have not been modified to include malicious software.

## Detection

### Detection Strategy for T1525 – Implant Internal Image

## Risk Assessment

| Finding                                     | Severity | Impact      |
| ------------------------------------------- | -------- | ----------- |
| Implant Internal Image technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Rhino Labs Cloud Image Backdoor Technique Sept 2019](https://rhinosecuritylabs.com/aws/cloud-container-attack-tool/)
- [Rhino Labs Cloud Backdoor September 2019](https://github.com/RhinoSecurityLabs/ccat)
- [Atomic Red Team - T1525](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1525)
- [MITRE ATT&CK - T1525](https://attack.mitre.org/techniques/T1525)
