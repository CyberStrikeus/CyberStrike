---
name: "T1027.017_svg-smuggling"
description: "Adversaries may smuggle data and files past content filters by hiding malicious payloads inside of seemingly benign SVG files."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1027.017
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1027.017"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1027/017"
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
  - T1027.009
  - T1027.010
  - T1027.011
  - T1027.012
  - T1027.013
  - T1027.014
  - T1027.015
  - T1027.016
prerequisites:
  - T1027
severity_boost:
  T1027: "Chain with T1027 for deeper attack path"
  T1027.001: "Chain with T1027.001 for deeper attack path"
  T1027.002: "Chain with T1027.002 for deeper attack path"
---

# T1027.017 SVG Smuggling

> **Sub-technique of:** T1027

## High-Level Description

Adversaries may smuggle data and files past content filters by hiding malicious payloads inside of seemingly benign SVG files. SVGs, or Scalable Vector Graphics, are vector-based image files constructed using XML. As such, they can legitimately include `<script>` tags that enable adversaries to include malicious JavaScript payloads. However, SVGs may appear less suspicious to users than other types of executable files, as they are often treated as image files.

SVG smuggling can take a number of forms. For example, threat actors may include content that:

- Assembles malicious payloads
- Downloads malicious payloads
- Redirects users to malicious websites
- Displays interactive content to users, such as fake login forms and download buttons.

SVG Smuggling may be used in conjunction with HTML Smuggling where an SVG with a malicious payload is included inside an HTML file. SVGs may also be included in other types of documents, such as PDFs.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if SVG Smuggling technique is applicable to target environment
- [ ] Check Linux systems for indicators of SVG Smuggling
- [ ] Check macOS systems for indicators of SVG Smuggling
- [ ] Check Windows systems for indicators of SVG Smuggling
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to SVG Smuggling by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1027.017 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1048 Application Isolation and Sandboxing

Browser sandboxes can be used to mitigate some of the impact of exploitation, but sandbox escapes may still exist.

## Detection

### Detection Strategy for SVG Smuggling with Script Execution and Delivery Behavior

## Risk Assessment

| Finding                            | Severity | Impact          |
| ---------------------------------- | -------- | --------------- |
| SVG Smuggling technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Talos SVG Smuggling 2022](https://blog.talosintelligence.com/html-smugglers-turn-to-svg-images/)
- [Trustwave SVG Smuggling 2025](https://www.trustwave.com/en-us/resources/blogs/spiderlabs-blog/pixel-perfect-trap-the-surge-of-svg-borne-phishing-attacks/)
- [Bleeping Computer SVG Smuggling 2024](https://www.bleepingcomputer.com/news/security/phishing-emails-increasingly-use-svg-attachments-to-evade-detection/)
- [Cofense SVG Smuggling 2024](https://cofense.com/blog/svg-files-abused-in-emerging-campaigns/)
- [Atomic Red Team - T1027.017](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1027.017)
- [MITRE ATT&CK - T1027.017](https://attack.mitre.org/techniques/T1027/017)
