---
name: "T1204.003_malicious-image"
description: "Adversaries may rely on a user running a malicious image to facilitate execution."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1204.003
  - execution
  - iaas
  - containers
  - sub-technique
technique_id: "T1204.003"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - IaaS
  - Containers
mitre_url: "https://attack.mitre.org/techniques/T1204/003"
tech_stack:
  - cloud
  - containers
cwe_ids:
  - CWE-94
chains_with:
  - T1204
  - T1204.001
  - T1204.002
  - T1204.004
  - T1204.005
prerequisites:
  - T1204
severity_boost:
  T1204: "Chain with T1204 for deeper attack path"
  T1204.001: "Chain with T1204.001 for deeper attack path"
  T1204.002: "Chain with T1204.002 for deeper attack path"
---

# T1204.003 Malicious Image

> **Sub-technique of:** T1204

## High-Level Description

Adversaries may rely on a user running a malicious image to facilitate execution. Amazon Web Services (AWS) Amazon Machine Images (AMIs), Google Cloud Platform (GCP) Images, and Azure Images as well as popular container runtimes such as Docker can be backdoored. Backdoored images may be uploaded to a public repository via Upload Malware, and users may then download and deploy an instance or container from the image without realizing the image is malicious, thus bypassing techniques that specifically achieve Initial Access. This can lead to the execution of malicious code, such as code that executes cryptocurrency mining, in the instance or container.

Adversaries may also name images a certain way to increase the chance of users mistakenly deploying an instance or container from the image (ex: Match Legitimate Resource Name or Location).

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** IaaS, Containers

## What to Check

- [ ] Identify if Malicious Image technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Malicious Image
- [ ] Check Containers systems for indicators of Malicious Image
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Malicious Image by examining the target platforms (IaaS, Containers).

2. **Assess Existing Defenses**: Review whether mitigations for T1204.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1045 Code Signing
Utilize a trust model such as Docker Content Trust with digital signatures to ensure runtime verification of the integrity and publisher of specific image tags.

### M1031 Network Intrusion Prevention
Network prevention intrusion systems and systems designed to scan and remove malicious downloads can be used to block activity.

### M1017 User Training
Train users to be aware of the existence of malicious images and how to avoid deploying instances and containers from them.

### M1047 Audit
Audit images deployed within the environment to ensure they do not contain any malicious components.


## Detection

### User Execution – Malicious Image (containers & IaaS) – pull/run → start → anomalous behavior (T1204.003)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Malicious Image technique applicable | High | Execution |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-94 | Improper Control of Generation of Code |


## References

- [Summit Route Malicious AMIs](https://summitroute.com/blog/2018/09/24/investigating_malicious_amis/)
- [Aqua Security Cloud Native Threat Report June 2021](https://info.aquasec.com/hubfs/Threat%20reports/AquaSecurity_Cloud_Native_Threat_Report_2021.pdf?utm_campaign=WP%20-%20Jun2021%20Nautilus%202021%20Threat%20Research%20Report&utm_medium=email&_hsmi=132931006&_hsenc=p2ANqtz-_8oopT5Uhqab8B7kE0l3iFo1koirxtyfTehxF7N-EdGYrwk30gfiwp5SiNlW3G0TNKZxUcDkYOtwQ9S6nNVNyEO-Dgrw&utm_content=132931006&utm_source=hs_automation)
- [Atomic Red Team - T1204.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1204.003)
- [MITRE ATT&CK - T1204.003](https://attack.mitre.org/techniques/T1204/003)
