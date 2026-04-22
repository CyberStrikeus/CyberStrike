---
name: "T1195_supply-chain-compromise"
description: "Adversaries may manipulate products or product delivery mechanisms prior to receipt by a final consumer for the purpose of data or system compromise."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1195
  - initial-access
  - linux
  - windows
  - macos
  - saas
technique_id: "T1195"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Linux
  - Windows
  - macOS
  - SaaS
mitre_url: "https://attack.mitre.org/techniques/T1195"
tech_stack:
  - linux
  - windows
  - macos
  - saas
cwe_ids:
  - CWE-20
chains_with:
  - T1195.001
  - T1195.002
  - T1195.003
prerequisites: []
severity_boost:
  T1195.001: "Chain with T1195.001 for deeper attack path"
  T1195.002: "Chain with T1195.002 for deeper attack path"
  T1195.003: "Chain with T1195.003 for deeper attack path"
---

# T1195 Supply Chain Compromise

## High-Level Description

Adversaries may manipulate products or product delivery mechanisms prior to receipt by a final consumer for the purpose of data or system compromise.

Supply chain compromise can take place at any stage of the supply chain including:

- Manipulation of development tools
- Manipulation of a development environment
- Manipulation of source code repositories (public or private)
- Manipulation of source code in open-source dependencies
- Manipulation of software update/distribution mechanisms
- Compromised/infected system images (removable media infected at the factory)
- Replacement of legitimate software with modified versions
- Sales of modified/counterfeit products to legitimate distributors
- Shipment interdiction

While supply chain compromise can impact any component of hardware or software, adversaries looking to gain execution have often focused on malicious additions to legitimate software in software distribution or update channels. Adversaries may limit targeting to a desired victim set or distribute malicious software to a broad set of consumers but only follow up with specific victims. Popular open-source projects that are used as dependencies in many applications may also be targeted as a means to add malicious code to users of the dependency.

In some cases, adversaries may conduct “second-order” supply chain compromises by leveraging the access gained from an initial supply chain compromise to further compromise a software component. This may allow the threat actor to spread to even more victims.

## Kill Chain Phase

- Initial Access (TA0001)

**Platforms:** Linux, Windows, macOS, SaaS

## What to Check

- [ ] Identify if Supply Chain Compromise technique is applicable to target environment
- [ ] Check Linux systems for indicators of Supply Chain Compromise
- [ ] Check Windows systems for indicators of Supply Chain Compromise
- [ ] Check macOS systems for indicators of Supply Chain Compromise
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Octopus Scanner Malware Open Source Supply Chain

This test simulates an adversary Octopus drop the RAT dropper ExplorerSync.db
[octopus-scanner-malware-open-source-supply-chain](https://securitylab.github.com/research/octopus-scanner-malware-open-source-supply-chain/)
[the-supreme-backdoor-factory](https://www.dfir.it/blog/2019/02/26/the-supreme-backdoor-factory/)

**Supported Platforms:** windows

```cmd
copy %temp%\ExplorerSync.db %temp%\..\Microsoft\ExplorerSync.db
schtasks /create /tn ExplorerSync /tr "javaw -jar %temp%\..\Microsoft\ExplorerSync.db" /sc MINUTE /f
```

**Dependencies:**

- ExplorerSync.db must exist on disk at specified location (#{rat_payload})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Supply Chain Compromise by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1195 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1046 Boot Integrity

Use secure methods to boot a system and verify the integrity of the operating system and loading mechanisms.

### M1013 Application Developer Guidance

Application developers should be cautious when selecting third-party libraries to integrate into their application. Additionally, where possible, developers should lock software dependencies to specific versions rather than pulling the latest version on build.

### M1051 Update Software

A patch management process should be implemented to check unused dependencies, unmaintained and/or previously vulnerable dependencies, unnecessary features, components, files, and documentation.

### M1018 User Account Management

Implement robust user account management practices to limit permissions associated with software execution. Ensure that software runs with the lowest necessary privileges, avoiding the use of root or administrator accounts when possible. By restricting permissions, you can minimize the risk of propagation and unauthorized actions in the event of a supply chain compromise, reducing the attack surface for adversaries to exploit within compromised systems.

### M1016 Vulnerability Scanning

Continuous monitoring of vulnerability sources and the use of automatic and manual code review tools should also be implemented as well.

### M1033 Limit Software Installation

Where possible, consider requiring developers to pull from internal repositories containing verified and approved packages rather than from external ones.

## Detection

### Behavioral detection for Supply Chain Compromise (package/update tamper → install → first-run)

## Risk Assessment

| Finding                                      | Severity | Impact         |
| -------------------------------------------- | -------- | -------------- |
| Supply Chain Compromise technique applicable | Low      | Initial Access |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [Avast CCleaner3 2018](https://blog.avast.com/new-investigations-in-ccleaner-incident-point-to-a-possible-third-stage-that-had-keylogger-capacities)
- [Krebs 3cx overview 2023](https://krebsonsecurity.com/2023/04/3cx-breach-was-a-double-supply-chain-compromise/)
- [Command Five SK 2011](https://web.archive.org/web/20160309235002/https://www.commandfive.com/papers/C5_APT_SKHack.pdf)
- [IBM Storwize](https://www-01.ibm.com/support/docview.wss?uid=ssg1S1010146&myns=s028&mynp=OCSTHGUJ&mynp=OCSTLM5A&mynp=OCSTLM6B&mynp=OCHW206&mync=E&cm_sp=s028-_-OCSTHGUJ-OCSTLM5A-OCSTLM6B-OCHW206-_-E)
- [Symantec Elderwood Sept 2012](https://web.archive.org/web/20190717233006/http:/www.symantec.com/content/en/us/enterprise/media/security_response/whitepapers/the-elderwood-project.pdf)
- [Schneider Electric USB Malware](https://www.se.com/us/en/download/document/SESN-2018-236-01/)
- [Trendmicro NPM Compromise](https://www.trendmicro.com/vinfo/dk/security/news/cybercrime-and-digital-threats/hacker-infects-node-js-package-to-steal-from-bitcoin-wallets)
- [Microsoft Dofoil 2018](https://cloudblogs.microsoft.com/microsoftsecure/2018/03/07/behavior-monitoring-combined-with-machine-learning-spoils-a-massive-dofoil-coin-mining-campaign/)
- [Atomic Red Team - T1195](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1195)
- [MITRE ATT&CK - T1195](https://attack.mitre.org/techniques/T1195)
