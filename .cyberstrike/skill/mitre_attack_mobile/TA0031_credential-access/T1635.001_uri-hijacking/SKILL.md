---
name: "T1635.001_uri-hijacking"
description: "Adversaries may register Uniform Resource Identifiers (URIs) to intercept sensitive data."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1635.001
  - credential-access
  - android
  - ios
  - sub-technique
technique_id: "T1635.001"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1635/001"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-522
chains_with:
  - T1635
prerequisites:
  - T1635
severity_boost:
  T1635: "Chain with T1635 for deeper attack path"
---

# T1635.001 URI Hijacking

> **Sub-technique of:** T1635

## High-Level Description

Adversaries may register Uniform Resource Identifiers (URIs) to intercept sensitive data.

Applications regularly register URIs with the operating system to act as a response handler for various actions, such as logging into an app using an external account via single sign-on. This allows redirections to that specific URI to be intercepted by the application. If an adversary were to register for a URI that was already in use by a genuine application, the adversary may be able to intercept data intended for the genuine application or perform a phishing attack against the genuine application. Intercepted data may include OAuth authorization codes or tokens that could be used by the adversary to gain access to protected resources.

## Kill Chain Phase

- Credential Access (TA0031)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if URI Hijacking technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of URI Hijacking
- [ ] Check iOS devices for indicators of URI Hijacking
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to URI Hijacking by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1635.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1013 Application Developer Guidance

Developers should use Android App Links and iOS Universal Links to provide a secure binding between URIs and applications, preventing malicious applications from intercepting redirections. Additionally, for OAuth use cases, PKCE should be used to prevent use of stolen authorization codes.

### M1011 User Guidance

Users should be instructed to not open links in applications they don’t recognize.

### M1006 Use Recent OS Version

iOS 11 introduced a first-come-first-served principle for URIs, allowing only the prior installed app to be launched via the URI. Android 6 introduced App Links.

## Detection

### Detection of URI Hijacking

## Risk Assessment

| Finding                            | Severity | Impact            |
| ---------------------------------- | -------- | ----------------- |
| URI Hijacking technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Android-AppLinks](https://developer.android.com/training/app-links/index.html)
- [Trend Micro iOS URL Hijacking](https://web.archive.org/web/20211023221110/https://blog.trendmicro.com/trendlabs-security-intelligence/ios-url-scheme-susceptible-to-hijacking/)
- [IETF-PKCE](https://tools.ietf.org/html/rfc7636)
- [IETF-OAuthNativeApps](https://tools.ietf.org/html/rfc8252)
- [MITRE ATT&CK Mobile - T1635.001](https://attack.mitre.org/techniques/T1635/001)
