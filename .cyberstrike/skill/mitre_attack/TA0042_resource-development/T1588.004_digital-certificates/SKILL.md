---
name: "T1588.004_digital-certificates"
description: "Adversaries may buy and/or steal SSL/TLS certificates that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1588.004
  - resource-development
  - pre
  - sub-technique
technique_id: "T1588.004"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1588/004"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1588
  - T1588.001
  - T1588.002
  - T1588.003
  - T1588.005
  - T1588.006
  - T1588.007
prerequisites:
  - T1588
severity_boost:
  T1588: "Chain with T1588 for deeper attack path"
  T1588.001: "Chain with T1588.001 for deeper attack path"
  T1588.002: "Chain with T1588.002 for deeper attack path"
---

# T1588.004 Digital Certificates

> **Sub-technique of:** T1588

## High-Level Description

Adversaries may buy and/or steal SSL/TLS certificates that can be used during targeting. SSL/TLS certificates are designed to instill trust. They include information about the key, information about its owner's identity, and the digital signature of an entity that has verified the certificate's contents are correct. If the signature is valid, and the person examining the certificate trusts the signer, then they know they can use that key to communicate with its owner.

Adversaries may purchase or steal SSL/TLS certificates to further their operations, such as encrypting C2 traffic (ex: Asymmetric Cryptography with Web Protocols) or even enabling Adversary-in-the-Middle if the certificate is trusted or otherwise added to the root of trust (i.e. Install Root Certificate). The purchase of digital certificates may be done using a front organization or using information stolen from a previously compromised entity that allows the adversary to validate to a certificate provider as that entity. Adversaries may also steal certificate materials directly from a compromised third-party, including from certificate authorities. Adversaries may register or hijack domains that they will later purchase an SSL/TLS certificate for.

Certificate authorities exist that allow adversaries to acquire SSL/TLS certificates, such as domain validation certificates, for free.

After obtaining a digital certificate, an adversary may then install that certificate (see Install Digital Certificate) on infrastructure under their control.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Digital Certificates technique is applicable to target environment
- [ ] Check PRE systems for indicators of Digital Certificates
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Digital Certificates by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1588.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Digital Certificates


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Digital Certificates technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [DiginotarCompromise](https://threatpost.com/final-report-diginotar-hack-shows-total-compromise-ca-servers-103112/77170/)
- [Recorded Future Beacon Certificates](https://www.recordedfuture.com/research/cobalt-strike-servers)
- [Splunk Kovar Certificates 2017](https://www.splunk.com/en_us/blog/security/tall-tales-of-hunting-with-tls-ssl-certificates.html)
- [Let's Encrypt FAQ](https://letsencrypt.org/docs/faq/)
- [Atomic Red Team - T1588.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1588.004)
- [MITRE ATT&CK - T1588.004](https://attack.mitre.org/techniques/T1588/004)
