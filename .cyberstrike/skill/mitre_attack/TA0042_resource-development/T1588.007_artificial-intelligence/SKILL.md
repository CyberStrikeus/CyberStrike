---
name: "T1588.007_artificial-intelligence"
description: "Adversaries may obtain access to generative artificial intelligence tools, such as large language models (LLMs), to aid various techniques during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1588.007
  - resource-development
  - pre
  - sub-technique
technique_id: "T1588.007"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1588/007"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1588
  - T1588.001
  - T1588.002
  - T1588.003
  - T1588.004
  - T1588.005
  - T1588.006
prerequisites:
  - T1588
severity_boost:
  T1588: "Chain with T1588 for deeper attack path"
  T1588.001: "Chain with T1588.001 for deeper attack path"
  T1588.002: "Chain with T1588.002 for deeper attack path"
---

# T1588.007 Artificial Intelligence

> **Sub-technique of:** T1588

## High-Level Description

Adversaries may obtain access to generative artificial intelligence tools, such as large language models (LLMs), to aid various techniques during targeting. These tools may be used to inform, bolster, and enable a variety of malicious tasks, including conducting Reconnaissance, creating basic scripts, assisting social engineering, and even developing payloads. 

For example, by utilizing a publicly available LLM an adversary is essentially outsourcing or automating certain tasks to the tool. Using AI, the adversary may draft and generate content in a variety of written languages to be used in Phishing/Phishing for Information campaigns. The same publicly available tool may further enable vulnerability or other offensive research supporting Develop Capabilities. AI tools may also automate technical tasks by generating, refining, or otherwise enhancing (e.g., Obfuscated Files or Information) malicious scripts and payloads. Finally, AI-generated text, images, audio, and video may be used for fraud, Impersonation, and other malicious activities.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Artificial Intelligence technique is applicable to target environment
- [ ] Check PRE systems for indicators of Artificial Intelligence
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Artificial Intelligence by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1588.007 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Artificial Intelligence


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Artificial Intelligence technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [WSJ-Vishing-AI24](https://www.wsj.com/articles/fraudsters-use-ai-to-mimic-ceos-voice-in-unusual-cybercrime-case-11567157402)
- [Google-Vishing24](https://cloud.google.com/blog/topics/threat-intelligence/ai-powered-voice-spoofing-vishing-attacks)
- [IC3-AI24](https://www.ic3.gov/PSA/2024/PSA241203)
- [MSFT-AI](https://www.microsoft.com/en-us/security/blog/2024/02/14/staying-ahead-of-threat-actors-in-the-age-of-ai/)
- [OpenAI-CTI](https://openai.com/index/disrupting-malicious-uses-of-ai-by-state-affiliated-threat-actors/)
- [Atomic Red Team - T1588.007](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1588.007)
- [MITRE ATT&CK - T1588.007](https://attack.mitre.org/techniques/T1588/007)
