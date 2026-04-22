---
name: "T1596.003_digital-certificates"
description: "Adversaries may search public digital certificate data for information about victims that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1596.003
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1596.003"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1596/003"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1596
  - T1596.001
  - T1596.002
  - T1596.004
  - T1596.005
prerequisites:
  - T1596
severity_boost:
  T1596: "Chain with T1596 for deeper attack path"
  T1596.001: "Chain with T1596.001 for deeper attack path"
  T1596.002: "Chain with T1596.002 for deeper attack path"
---

# T1596.003 Digital Certificates

> **Sub-technique of:** T1596

## High-Level Description

Adversaries may search public digital certificate data for information about victims that can be used during targeting. Digital certificates are issued by a certificate authority (CA) in order to cryptographically verify the origin of signed content. These certificates, such as those used for encrypted web traffic (HTTPS SSL/TLS communications), contain information about the registered organization such as name and location.

Adversaries may search digital certificate data to gather actionable information. Threat actors can use online resources and lookup tools to harvest information about certificates. Digital certificate data may also be available from artifacts signed by the organization (ex: certificates used from encrypted web traffic are served with content). Information from these sources may reveal opportunities for other forms of reconnaissance (ex: Active Scanning or Phishing for Information), establishing operational resources (ex: Develop Capabilities or Obtain Capabilities), and/or initial access (ex: External Remote Services or Trusted Relationship).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Digital Certificates technique is applicable to target environment
- [ ] Check PRE systems for indicators of Digital Certificates
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Digital Certificates by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1596.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.

## Detection

### Detection of Digital Certificates

## Risk Assessment

| Finding                                   | Severity | Impact         |
| ----------------------------------------- | -------- | -------------- |
| Digital Certificates technique applicable | High     | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Medium SSL Cert](https://medium.com/@menakajain/export-download-ssl-certificate-from-server-site-url-bcfc41ea46a2)
- [SSLShopper Lookup](https://www.sslshopper.com/ssl-checker.html)
- [Atomic Red Team - T1596.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1596.003)
- [MITRE ATT&CK - T1596.003](https://attack.mitre.org/techniques/T1596/003)
