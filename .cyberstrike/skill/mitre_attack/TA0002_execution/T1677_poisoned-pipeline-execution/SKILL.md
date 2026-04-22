---
name: "T1677_poisoned-pipeline-execution"
description: "Adversaries may manipulate continuous integration / continuous development (CI/CD) processes by injecting malicious code into the build process."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1677
  - execution
  - saas
technique_id: "T1677"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - SaaS
mitre_url: "https://attack.mitre.org/techniques/T1677"
tech_stack:
  - saas
cwe_ids:
  - CWE-94
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1677 Poisoned Pipeline Execution

## High-Level Description

Adversaries may manipulate continuous integration / continuous development (CI/CD) processes by injecting malicious code into the build process. There are several mechanisms for poisoning pipelines:

- In a <b>Direct Pipeline Execution</b> scenario, the threat actor directly modifies the CI configuration file (e.g., `gitlab-ci.yml` in GitLab). They may include a command to exfiltrate credentials leveraged in the build process to a remote server, or to export them as a workflow artifact.
- In an <b>Indirect Pipeline Execution</b> scenario, the threat actor injects malicious code into files referenced by the CI configuration file. These may include makefiles, scripts, unit tests, and linters.
- In a <b>Public Pipeline Execution</b> scenario, the threat actor does not have direct access to the repository but instead creates a malicious pull request from a fork that triggers a part of the CI/CD pipeline. For example, in GitHub Actions, the `pull_request_target` trigger allows workflows running from forked repositories to access secrets. If this trigger is combined with an explicit pull request checkout and a location for a threat actor to insert malicious code (e.g., an `npm build` command), a threat actor may be able to leak pipeline credentials. Similarly, threat actors may craft pull requests with malicious inputs (such as branch names) if the build pipeline treats those inputs as trusted. Finally, if a pipeline leverages a self-hosted runner, a threat actor may be able to execute arbitrary code on a host inside the organization’s network.

By poisoning CI/CD pipelines, threat actors may be able to gain access to credentials, laterally move to additional hosts, or input malicious components to be shipped further down the pipeline (i.e., Supply Chain Compromise).

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** SaaS

## What to Check

- [ ] Identify if Poisoned Pipeline Execution technique is applicable to target environment
- [ ] Check SaaS systems for indicators of Poisoned Pipeline Execution
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Poisoned Pipeline Execution by examining the target platforms (SaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1677 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management

Ensure that CI/CD pipelines only have permissions they require to complete their operations. Additionally, limit the number of users who have write access to internal repositories to only those necessary.

### M1054 Software Configuration

Where possible, avoid allowing pipelines to run unreviewed code. Where this is necessary, ensure that these pipelines are executed on isolated nodes without access to secrets. In GitHub, avoid using the `pull_request_target` trigger if possible, do not treat user-controlled inputs (such as branch names) as trusted, and do not use self-hosted runners on public repositories.

## Detection

### Detection Strategy for Poisoned Pipeline Execution via SaaS CI/CD Workflows

## Risk Assessment

| Finding                                          | Severity | Impact    |
| ------------------------------------------------ | -------- | --------- |
| Poisoned Pipeline Execution technique applicable | High     | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Synactiv Hijacking GitHub Runners](https://www.synacktiv.com/en/publications/hijacking-github-runners-to-compromise-the-organization)
- [GitHub Security Lab GitHub Actions Security 2021](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/)
- [GitHub Security Labs GitHub Actions Security Part 2 2021](https://securitylab.github.com/resources/github-actions-untrusted-input/)
- [John Stawinski PyTorch Supply Chain Attack 2024](https://johnstawinski.com/2024/01/11/playing-with-fire-how-we-executed-a-critical-supply-chain-attack-on-pytorch/)
- [Unit 42 Palo Alto GitHub Actions Supply Chain Attack 2025](https://unit42.paloaltonetworks.com/github-actions-supply-chain-attack)
- [OWASP CICD-SEC-4](https://owasp.org/www-project-top-10-ci-cd-security-risks/CICD-SEC-04-Poisoned-Pipeline-Execution)
- [Wiz Ultralytics AI Library Hijack 2024](https://www.wiz.io/blog/ultralytics-ai-library-hacked-via-github-for-cryptomining)
- [Atomic Red Team - T1677](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1677)
- [MITRE ATT&CK - T1677](https://attack.mitre.org/techniques/T1677)
