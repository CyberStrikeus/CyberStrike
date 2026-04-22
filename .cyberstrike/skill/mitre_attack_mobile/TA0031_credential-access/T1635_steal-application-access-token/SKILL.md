---
name: "T1635_steal-application-access-token"
description: "Adversaries can steal user application access tokens as a means of acquiring credentials to access remote systems and resources."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1635
  - credential-access
  - android
  - ios
technique_id: "T1635"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1635"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-522
chains_with:
  - T1635.001
prerequisites: []
severity_boost:
  T1635.001: "Chain with T1635.001 for deeper attack path"
---

# T1635 Steal Application Access Token

## High-Level Description

Adversaries can steal user application access tokens as a means of acquiring credentials to access remote systems and resources. This can occur through social engineering or URI hijacking and typically requires user action to grant access, such as through a system “Open With” dialogue.

Application access tokens are used to make authorized API requests on behalf of a user and are commonly used as a way to access resources in cloud-based applications and software-as-a-service (SaaS). OAuth is one commonly implemented framework used to issue tokens to users for access to systems. An application desiring access to cloud-based services or protected APIs can gain entry through OAuth 2.0 using a variety of authorization protocols. An example of a commonly-used sequence is Microsoft's Authorization Code Grant flow. An OAuth access token enables a third-party application to interact with resources containing user data in the ways requested without requiring user credentials.

## Kill Chain Phase

- Credential Access (TA0031)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Steal Application Access Token technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Steal Application Access Token
- [ ] Check iOS devices for indicators of Steal Application Access Token
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Steal Application Access Token by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1635 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version

iOS 11 introduced a first-come-first-served principle for URIs, allowing only the prior installed app to be launched via the URI. Android 6 introduced App Links.

### M1011 User Guidance

Users should be instructed to not open links in applications they don’t recognize.

### M1013 Application Developer Guidance

Developers should use Android App Links and iOS Universal Links to provide a secure binding between URIs and applications, preventing malicious applications from intercepting redirections. Additionally, for OAuth use cases, PKCE should be used to prevent use of stolen authorization codes.

## Detection

### Detection of Steal Application Access Token

## Risk Assessment

| Finding                                             | Severity | Impact            |
| --------------------------------------------------- | -------- | ----------------- |
| Steal Application Access Token technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Android-AppLinks](https://developer.android.com/training/app-links/index.html)
- [Auth0 - Why You Should Always Use Access Tokens to Secure APIs Sept 2019](https://auth0.com/blog/why-should-use-accesstokens-to-secure-an-api/)
- [Microsoft - OAuth Code Authorization flow - June 2019](https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow)
- [Microsoft Identity Platform Protocols May 2019](https://docs.microsoft.com/en-us/azure/active-directory/develop/active-directory-v2-protocols)
- [IETF-OAuthNativeApps](https://tools.ietf.org/html/rfc8252)
- [MITRE ATT&CK Mobile - T1635](https://attack.mitre.org/techniques/T1635)
