---
name: "T1480.001_environmental-keying"
description: "Adversaries may environmentally key payloads or other features of malware to evade defenses and constraint execution to a specific target environment."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1480.001
  - defense-evasion
  - linux
  - windows
  - macos
  - sub-technique
technique_id: "T1480.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1480/001"
tech_stack:
  - linux
  - windows
  - macos
cwe_ids:
  - CWE-693
chains_with:
  - T1480
  - T1480.002
prerequisites:
  - T1480
severity_boost:
  T1480: "Chain with T1480 for deeper attack path"
  T1480.002: "Chain with T1480.002 for deeper attack path"
---

# T1480.001 Environmental Keying

> **Sub-technique of:** T1480

## High-Level Description

Adversaries may environmentally key payloads or other features of malware to evade defenses and constraint execution to a specific target environment. Environmental keying uses cryptography to constrain execution or actions based on adversary supplied environment specific conditions that are expected to be present on the target. Environmental keying is an implementation of Execution Guardrails that utilizes cryptographic techniques for deriving encryption/decryption keys from specific types of values in a given computing environment.

Values can be derived from target-specific elements and used to generate a decryption key for an encrypted payload. Target-specific values can be derived from specific network shares, physical devices, software/software versions, files, joined AD domains, system time, and local/external IP addresses. By generating the decryption keys from target-specific environmental values, environmental keying can make sandbox detection, anti-virus detection, crowdsourcing of information, and reverse engineering difficult. These difficulties can slow down the incident response process and help adversaries hide their tactics, techniques, and procedures (TTPs).

Similar to Obfuscated Files or Information, adversaries may use environmental keying to help protect their TTPs and evade detection. Environmental keying may be used to deliver an encrypted payload to the target that will use target-specific values to decrypt the payload before execution. By utilizing target-specific values to decrypt the payload the adversary can avoid packaging the decryption key with the payload or sending it over a potentially monitored network connection. Depending on the technique for gathering target-specific values, reverse engineering of the encrypted payload can be exceptionally difficult. This can be used to prevent exposure of capabilities in environments that are not intended to be compromised or operated within.

Like other Execution Guardrails, environmental keying can be used to prevent exposure of capabilities in environments that are not intended to be compromised or operated within. This activity is distinct from typical Virtualization/Sandbox Evasion. While use of Virtualization/Sandbox Evasion may involve checking for known sandbox values and continuing with execution only if there is no match, the use of environmental keying will involve checking for an expected target-specific value that must match for decryption and subsequent execution to be successful.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, Windows, macOS

## What to Check

- [ ] Identify if Environmental Keying technique is applicable to target environment
- [ ] Check Linux systems for indicators of Environmental Keying
- [ ] Check Windows systems for indicators of Environmental Keying
- [ ] Check macOS systems for indicators of Environmental Keying
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Environmental Keying by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1480.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1055 Do Not Mitigate
Environmental Keying likely should not be mitigated with preventative controls because it may protect unintended targets from being compromised via confusion of keys by the adversary. Mitigation of this technique is also unlikely to be feasible within most contexts because there are no standard attributes from which an adversary may derive keys. If targeted, efforts should be focused on preventing adversary tools from running earlier in the chain of activity and on identifying subsequent malicious behavior if compromised.


## Detection

### Environmental Keying Discovery-to-Decryption Behavioral Chain Detection Strategy


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Environmental Keying technique applicable | Medium | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Proofpoint Router Malvertising](https://www.proofpoint.com/us/threat-insight/post/home-routers-under-attack-malvertising-windows-android-devices)
- [Kaspersky Gauss Whitepaper](https://media.kasperskycontenthub.com/wp-content/uploads/sites/43/2018/03/20134940/kaspersky-lab-gauss.pdf)
- [Ebowla: Genetic Malware](https://github.com/Genetic-Malware/Ebowla/blob/master/Eko_2016_Morrow_Pitts_Master.pdf)
- [EK Clueless Agents](https://www.schneier.com/academic/paperfiles/paper-clueless-agents.pdf)
- [EK Impeding Malware Analysis](https://pdfs.semanticscholar.org/2721/3d206bc3c1e8c229fb4820b6af09e7f975da.pdf)
- [Demiguise Guardrail Router Logo](https://github.com/nccgroup/demiguise/blob/master/examples/virginkey.js)
- [Environmental Keyed HTA](http://web.archive.org/web/20200608093807/https://www.nccgroup.com/uk/about-us/newsroom-and-events/blogs/2017/august/smuggling-hta-files-in-internet-exploreredge/)
- [Atomic Red Team - T1480.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1480.001)
- [MITRE ATT&CK - T1480.001](https://attack.mitre.org/techniques/T1480/001)
