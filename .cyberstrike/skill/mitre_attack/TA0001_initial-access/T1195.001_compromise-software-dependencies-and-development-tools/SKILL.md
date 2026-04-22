---
name: "T1195.001_compromise-software-dependencies-and-development-tools"
description: "Adversaries may manipulate software dependencies and development tools prior to receipt by a final consumer for the purpose of data or system compromise."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1195.001
  - initial-access
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1195.001"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1195/001"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-20
chains_with:
  - T1195
  - T1195.002
  - T1195.003
prerequisites:
  - T1195
severity_boost:
  T1195: "Chain with T1195 for deeper attack path"
  T1195.002: "Chain with T1195.002 for deeper attack path"
  T1195.003: "Chain with T1195.003 for deeper attack path"
---

# T1195.001 Compromise Software Dependencies and Development Tools

> **Sub-technique of:** T1195

## High-Level Description

Adversaries may manipulate software dependencies and development tools prior to receipt by a final consumer for the purpose of data or system compromise. Applications often depend on external software to function properly. Popular open source projects that are used as dependencies in many applications, such as pip and NPM packages, may be targeted as a means to add malicious code to users of the dependency. This may also include abandoned packages, which in some cases could be re-registered by threat actors after being removed by adversaries. Adversaries may also employ "typosquatting" or name-confusion by choosing names similar to existing popular libraries or packages in order to deceive a user.

Additionally, CI/CD pipeline components, such as GitHub Actions, may be targeted in order to gain access to the building, testing, and deployment cycles of an application. By adding malicious code into a GitHub action, a threat actor may be able to collect runtime credentials (e.g., via Proc Filesystem) or insert further malicious components into the build pipelines for a second-order supply chain compromise. As GitHub Actions are often dependent on other GitHub Actions, threat actors may be able to infect a large number of repositories via the compromise of a single Action.

Targeting may be specific to a desired victim set or may be distributed to a broad set of consumers but only move on to additional tactics on specific victims.

## Kill Chain Phase

- Initial Access (TA0001)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Compromise Software Dependencies and Development Tools technique is applicable to target environment
- [ ] Check Linux systems for indicators of Compromise Software Dependencies and Development Tools
- [ ] Check macOS systems for indicators of Compromise Software Dependencies and Development Tools
- [ ] Check Windows systems for indicators of Compromise Software Dependencies and Development Tools
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Compromise Software Dependencies and Development Tools by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1195.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1033 Limit Software Installation
Where possible, consider requiring developers to pull from internal repositories containing verified and approved packages rather than from external ones.

### M1016 Vulnerability Scanning
Continuous monitoring of vulnerability sources and the use of automatic and manual code review tools should also be implemented as well.

### M1051 Update Software
A patch management process should be implemented to check unused dependencies, unmaintained and/or previously vulnerable dependencies, unnecessary features, components, files, and documentation.

### M1013 Application Developer Guidance
Application developers should be cautious when selecting third-party libraries to integrate into their application. Additionally, where possible, developers should lock software dependencies to specific versions rather than pulling the latest version on build. GitHub Actions may be pinned to a specific commit hash rather than a tag or branch.


## Detection

### Supply-chain tamper in dependencies/dev-tools (manager→write/install→first-run→egress)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Compromise Software Dependencies and Development Tools technique applicable | High | Initial Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [Palo Alto Networks GitHub Actions Worm 2023](https://www.paloaltonetworks.com/blog/cloud-security/github-actions-worm-dependencies/)
- [Meyer PyPI Supply Chain Attack Uncovered](https://checkmarx.com/zero-post/python-pypi-supply-chain-attack-colorama/)
- [Ahmed Backdoors in Python and NPM Packages](https://hackread.com/backdoors-python-npm-packages-windows-linux/)
- [MANDVI Malicious npm and PyPI Packages Disguised](https://cyberpress.org/malicious-npm-and-pypi-packages-disguised-as-dev-tools)
- [Unit 42 Palo Alto GitHub Actions Supply Chain Attack 2025](https://unit42.paloaltonetworks.com/github-actions-supply-chain-attack)
- [OWASP CICD-SEC-4](https://owasp.org/www-project-top-10-ci-cd-security-risks/CICD-SEC-04-Poisoned-Pipeline-Execution)
- [The Hacker News PyPi Revival Hijack 2024](https://thehackernews.com/2024/09/hackers-hijack-22000-removed-pypi.html)
- [Bitdefender NPM Repositories Compromised 2021](https://www.bitdefender.com/en-gb/blog/hotforsecurity/popular-npm-repositories-compromised-in-man-in-the-middle-attack)
- [Trendmicro NPM Compromise](https://www.trendmicro.com/vinfo/dk/security/news/cybercrime-and-digital-threats/hacker-infects-node-js-package-to-steal-from-bitcoin-wallets)
- [Checkmarx-oss-seo](https://checkmarx.com/blog/new-technique-to-trick-developers-detected-in-an-open-source-supply-chain-attack/)
- [Atomic Red Team - T1195.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1195.001)
- [MITRE ATT&CK - T1195.001](https://attack.mitre.org/techniques/T1195/001)
