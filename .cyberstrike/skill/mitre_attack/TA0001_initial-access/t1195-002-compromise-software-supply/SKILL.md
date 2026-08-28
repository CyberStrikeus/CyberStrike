---
name: "T1195.002_compromise-software-supply-chain"
description: "Adversaries may manipulate application software prior to receipt by a final consumer for the purpose of data or system compromise."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1195.002
  - initial-access
  - linux
  - windows
  - macos
  - sub-technique
technique_id: "T1195.002"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Linux
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1195/002"
tech_stack:
  - linux
  - windows
  - macos
cwe_ids:
  - CWE-20
chains_with:
  - T1195
  - T1195.001
  - T1195.003
prerequisites:
  - T1195
severity_boost:
  T1195: "Chain with T1195 for deeper attack path"
  T1195.001: "Chain with T1195.001 for deeper attack path"
  T1195.003: "Chain with T1195.003 for deeper attack path"
---

# T1195.002 Compromise Software Supply Chain

> **Sub-technique of:** T1195

## High-Level Description

Adversaries may manipulate application software prior to receipt by a final consumer for the purpose of data or system compromise. Supply chain compromise of software can take place in a number of ways, including manipulation of the application source code, manipulation of the update/distribution mechanism for that software, or replacing compiled releases with a modified version.

Targeting may be specific to a desired victim set or may be distributed to a broad set of consumers but only move on to additional tactics on specific victims.

## Kill Chain Phase

- Initial Access (TA0001)

**Platforms:** Linux, Windows, macOS

## What to Check

- [ ] Identify if Compromise Software Supply Chain technique is applicable to target environment
- [ ] Check Linux systems for indicators of Compromise Software Supply Chain
- [ ] Check Windows systems for indicators of Compromise Software Supply Chain
- [ ] Check macOS systems for indicators of Compromise Software Supply Chain
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Simulate npm package installation on a Linux system

Launches a short‑lived Kubernetes pod using the Node 18 image, initializes a minimal npm project in /tmp/test, and installs the specified npm package without audit/fund/package‑lock options, simulating potentially suspicious package retrieval (e.g., typosquatting/dependency confusion) from within a container. The pod is deleted after execution.

**Supported Platforms:** containers, linux

```bash
kubectl run #{pod_name} --image=#{image_name} --restart=Never --attach --rm -i -- bash -lc "mkdir -p /tmp/test && cd /tmp/test && npm init -y >/dev/null 2>&1 && echo '--- package.json before install ---' && cat package.json && npm install #{package_name} --no-audit --no-fund --no-package-lock && echo '--- package.json after install ---' && cat package.json"
```

**Dependencies:**

- kubectl must be installed and configured

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Compromise Software Supply Chain by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1195.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1051 Update Software

A patch management process should be implemented to check unused applications, unmaintained and/or previously vulnerable software, unnecessary features, components, files, and documentation.

### M1016 Vulnerability Scanning

Continuous monitoring of vulnerability sources and the use of automatic and manual code review tools should also be implemented as well.

## Detection

### Compromised software/update chain (installer/write → first-run/child → egress/signature anomaly)

## Risk Assessment

| Finding                                               | Severity | Impact         |
| ----------------------------------------------------- | -------- | -------------- |
| Compromise Software Supply Chain technique applicable | Low      | Initial Access |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [Avast CCleaner3 2018](https://blog.avast.com/new-investigations-in-ccleaner-incident-point-to-a-possible-third-stage-that-had-keylogger-capacities)
- [Command Five SK 2011](https://web.archive.org/web/20160309235002/https://www.commandfive.com/papers/C5_APT_SKHack.pdf)
- [Atomic Red Team - T1195.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1195.002)
- [MITRE ATT&CK - T1195.002](https://attack.mitre.org/techniques/T1195/002)
