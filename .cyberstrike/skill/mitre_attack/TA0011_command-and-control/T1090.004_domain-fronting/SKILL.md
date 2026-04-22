---
name: "T1090.004_domain-fronting"
description: "Adversaries may take advantage of routing schemes in Content Delivery Networks (CDNs) and other services which host multiple domains to obfuscate the intended destination of HTTPS traffic or traffi..."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1090.004
  - command-and-control
  - linux
  - macos
  - windows
  - esxi
  - sub-technique
technique_id: "T1090.004"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Linux
  - macOS
  - Windows
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1090/004"
tech_stack:
  - linux
  - macos
  - windows
  - esxi
cwe_ids:
  - CWE-300
chains_with:
  - T1090
  - T1090.001
  - T1090.002
  - T1090.003
prerequisites:
  - T1090
severity_boost:
  T1090: "Chain with T1090 for deeper attack path"
  T1090.001: "Chain with T1090.001 for deeper attack path"
  T1090.002: "Chain with T1090.002 for deeper attack path"
---

# T1090.004 Domain Fronting

> **Sub-technique of:** T1090

## High-Level Description

Adversaries may take advantage of routing schemes in Content Delivery Networks (CDNs) and other services which host multiple domains to obfuscate the intended destination of HTTPS traffic or traffic tunneled through HTTPS. Domain fronting involves using different domain names in the SNI field of the TLS header and the Host field of the HTTP header. If both domains are served from the same CDN, then the CDN may route to the address specified in the HTTP header after unwrapping the TLS header. A variation of the the technique, "domainless" fronting, utilizes a SNI field that is left blank; this may allow the fronting to work even when the CDN attempts to validate that the SNI and HTTP Host fields match (if the blank SNI fields are ignored).

For example, if domain-x and domain-y are customers of the same CDN, it is possible to place domain-x in the TLS header and domain-y in the HTTP header. Traffic will appear to be going to domain-x, however the CDN may route it to domain-y.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** Linux, macOS, Windows, ESXi

## What to Check

- [ ] Identify if Domain Fronting technique is applicable to target environment
- [ ] Check Linux systems for indicators of Domain Fronting
- [ ] Check macOS systems for indicators of Domain Fronting
- [ ] Check Windows systems for indicators of Domain Fronting
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Domain Fronting by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1090.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1020 SSL/TLS Inspection

If it is possible to inspect HTTPS traffic, the captures can be analyzed for connections that appear to be domain fronting.

## Detection

### Domain Fronting Behavior via Mismatched TLS SNI and HTTP Host Headers

## Risk Assessment

| Finding                              | Severity | Impact              |
| ------------------------------------ | -------- | ------------------- |
| Domain Fronting technique applicable | Medium   | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [Fifield Blocking Resistent Communication through domain fronting 2015](http://www.icir.org/vern/papers/meek-PETS-2015.pdf)
- [Atomic Red Team - T1090.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1090.004)
- [MITRE ATT&CK - T1090.004](https://attack.mitre.org/techniques/T1090/004)
