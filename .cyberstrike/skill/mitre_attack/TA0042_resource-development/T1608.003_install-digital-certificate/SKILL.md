---
name: "T1608.003_install-digital-certificate"
description: "Adversaries may install SSL/TLS certificates that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1608.003
  - resource-development
  - pre
  - sub-technique
technique_id: "T1608.003"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1608/003"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1608
  - T1608.001
  - T1608.002
  - T1608.004
  - T1608.005
  - T1608.006
prerequisites:
  - T1608
severity_boost:
  T1608: "Chain with T1608 for deeper attack path"
  T1608.001: "Chain with T1608.001 for deeper attack path"
  T1608.002: "Chain with T1608.002 for deeper attack path"
---

# T1608.003 Install Digital Certificate

> **Sub-technique of:** T1608

## High-Level Description

Adversaries may install SSL/TLS certificates that can be used during targeting. SSL/TLS certificates are files that can be installed on servers to enable secure communications between systems. Digital certificates include information about the key, information about its owner's identity, and the digital signature of an entity that has verified the certificate's contents are correct. If the signature is valid, and the person examining the certificate trusts the signer, then they know they can use that key to communicate securely with its owner. Certificates can be uploaded to a server, then the server can be configured to use the certificate to enable encrypted communication with it.

Adversaries may install SSL/TLS certificates that can be used to further their operations, such as encrypting C2 traffic (ex: Asymmetric Cryptography with Web Protocols) or lending credibility to a credential harvesting site. Installation of digital certificates may take place for a number of server types, including web servers and email servers. 

Adversaries can obtain digital certificates (see Digital Certificates) or create self-signed certificates (see Digital Certificates). Digital certificates can then be installed on adversary controlled infrastructure that may have been acquired (Acquire Infrastructure) or previously compromised (Compromise Infrastructure).

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Install Digital Certificate technique is applicable to target environment
- [ ] Check PRE systems for indicators of Install Digital Certificate
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Install Digital Certificate by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1608.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Install Digital Certificate


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Install Digital Certificate technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [DigiCert Install SSL Cert](https://www.digicert.com/kb/ssl-certificate-installation.htm)
- [Splunk Kovar Certificates 2017](https://www.splunk.com/en_us/blog/security/tall-tales-of-hunting-with-tls-ssl-certificates.html)
- [Atomic Red Team - T1608.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1608.003)
- [MITRE ATT&CK - T1608.003](https://attack.mitre.org/techniques/T1608/003)
