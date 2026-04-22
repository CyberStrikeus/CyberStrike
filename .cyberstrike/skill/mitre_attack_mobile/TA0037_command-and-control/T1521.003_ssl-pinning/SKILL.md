---
name: "T1521.003_ssl-pinning"
description: "Adversaries may use SSL Pinning to protect the C2 traffic from being intercepted and analyzed."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1521.003
  - command-and-control
  - android
  - ios
  - sub-technique
technique_id: "T1521.003"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1521/003"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-300
chains_with:
  - T1521
  - T1521.001
  - T1521.002
prerequisites:
  - T1521
severity_boost:
  T1521: "Chain with T1521 for deeper attack path"
  T1521.001: "Chain with T1521.001 for deeper attack path"
  T1521.002: "Chain with T1521.002 for deeper attack path"
---

# T1521.003 SSL Pinning

> **Sub-technique of:** T1521

## High-Level Description

Adversaries may use SSL Pinning to protect the C2 traffic from being intercepted and analyzed.

SSL Pinning is a technique commonly utilized by legitimate websites to ensure that encrypted communications are only allowed with a pre-defined certificate. If another certificate is presented, it could indicate device compromise, traffic interception, or another upstream issue. While benign usages are common, it is also possible for adversaries to abuse this technology to protect malicious C2 traffic.

In normal, not pinned SSL validation, when a client connects to a server using HTTPS, it typically checks whether the server’s SSL/TLS certificate is signed by a trusted Certificate Authority (CA) in the device’s trust store. If the certificate is valid and signed by a trusted CA, the connection is established. However, with SSL Pinning , the client is configured to trust a specific SSL/TLS certificate or public key, rather than relying on the device’s trust store. This means that even if the server’s certificate is signed by a trusted CA, the client will only establish the connection of the certificate or key is pinned.

There are two types of SSL Pinning :

1.	Certificate Pinning: The client stores a copy of the server’s certificate and compares it with the certificate received during the SSL handshake. If the certificates match, then the client proceeds with the connection. This approach also works with self-signed certificates.

2.	Public Key Pinning: Instead of pinning the entire certificate, the client pins just the public key extracted from the certificate. This is often more flexible, as it allows the server to renew its certificate without having to update the pinned certificate or breaking the SSL connection.

## Kill Chain Phase

- Command and Control (TA0037)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if SSL Pinning technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of SSL Pinning
- [ ] Check iOS devices for indicators of SSL Pinning
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to SSL Pinning by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1521.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance
Users should be advised to not trust or install self-signed certificates.

### M1012 Enterprise Policy
Certain enterprise policies can be applied to prevent users from adding certificates to the device and to prevent applications from being able to install their own certificates.


## Detection

### Detection of SSL Pinning


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SSL Pinning technique applicable | Low | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [MITRE ATT&CK Mobile - T1521.003](https://attack.mitre.org/techniques/T1521/003)
