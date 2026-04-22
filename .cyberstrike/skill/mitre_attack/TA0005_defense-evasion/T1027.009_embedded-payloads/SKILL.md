---
name: "T1027.009_embedded-payloads"
description: "Adversaries may embed payloads within other files to conceal malicious content from defenses."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1027.009
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1027.009"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1027/009"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1027
  - T1027.001
  - T1027.002
  - T1027.003
  - T1027.004
  - T1027.005
  - T1027.006
  - T1027.007
  - T1027.008
  - T1027.010
  - T1027.011
  - T1027.012
  - T1027.013
  - T1027.014
  - T1027.015
  - T1027.016
  - T1027.017
prerequisites:
  - T1027
severity_boost:
  T1027: "Chain with T1027 for deeper attack path"
  T1027.001: "Chain with T1027.001 for deeper attack path"
  T1027.002: "Chain with T1027.002 for deeper attack path"
---

# T1027.009 Embedded Payloads

> **Sub-technique of:** T1027

## High-Level Description

Adversaries may embed payloads within other files to conceal malicious content from defenses. Otherwise seemingly benign files (such as scripts and executables) may be abused to carry and obfuscate malicious payloads and content. In some cases, embedded payloads may also enable adversaries to Subvert Trust Controls by not impacting execution controls such as digital signatures and notarization tickets.

Adversaries may embed payloads in various file formats to hide payloads. This is similar to Steganography, though does not involve weaving malicious content into specific bytes and patterns related to legitimate digital media formats.

For example, adversaries have been observed embedding payloads within or as an overlay of an otherwise benign binary. Adversaries have also been observed nesting payloads (such as executables and run-only scripts) inside a file of the same format.

Embedded content may also be used as Process Injection payloads used to infect benign system processes. These embedded then injected payloads may be used as part of the modules of malware designed to provide specific features such as encrypting C2 communications in support of an orchestrator module. For example, an embedded module may be injected into default browsers, allowing adversaries to then communicate via the network.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Embedded Payloads technique is applicable to target environment
- [ ] Check Linux systems for indicators of Embedded Payloads
- [ ] Check macOS systems for indicators of Embedded Payloads
- [ ] Check Windows systems for indicators of Embedded Payloads
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Embedded Payloads by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1027.009 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1049 Antivirus/Antimalware

Anti-virus can be used to automatically detect and quarantine suspicious files.

### M1040 Behavior Prevention on Endpoint

On Windows 10, enable Attack Surface Reduction (ASR) rules to prevent execution of potentially obfuscated scripts.

## Detection

### Detection Strategy for Embedded Payloads

## Risk Assessment

| Finding                                | Severity | Impact          |
| -------------------------------------- | -------- | --------------- |
| Embedded Payloads technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [GitHub PSImage](https://github.com/peewpw/Invoke-PSImage)
- [Malware Analysis Report ComRAT](https://www.cisa.gov/uscert/ncas/analysis-reports/ar20-303a)
- [Trend Micro](https://www.trendmicro.com/en_us/research/20/e/netwalker-fileless-ransomware-injected-via-reflective-loading.html)
- [Securelist Dtrack2](https://securelist.com/my-name-is-dtrack/93338/)
- [Microsoft Learn](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-shllink/c41e062d-f764-4f13-bd4f-ea812ab9a4d1)
- [SentinelLabs reversing run-only applescripts 2021](https://www.sentinelone.com/labs/fade-dead-adventures-in-reversing-malicious-run-only-applescripts/)
- [Sentinel Labs](https://www.sentinelone.com/labs/fade-dead-adventures-in-reversing-malicious-run-only-applescripts/)
- [Atomic Red Team - T1027.009](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1027.009)
- [MITRE ATT&CK - T1027.009](https://attack.mitre.org/techniques/T1027/009)
