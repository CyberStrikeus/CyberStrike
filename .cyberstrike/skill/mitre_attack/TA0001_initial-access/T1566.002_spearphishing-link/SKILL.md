---
name: "T1566.002_spearphishing-link"
description: "Adversaries may send spearphishing emails with a malicious link in an attempt to gain access to victim systems."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1566.002
  - initial-access
  - identity-provider
  - linux
  - macos
  - office-suite
  - saas
  - windows
  - sub-technique
technique_id: "T1566.002"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Identity Provider
  - Linux
  - macOS
  - Office Suite
  - SaaS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1566/002"
tech_stack:
  - identity
  - linux
  - macos
  - office
  - saas
  - windows
cwe_ids:
  - CWE-20
chains_with:
  - T1566
  - T1566.001
  - T1566.003
  - T1566.004
prerequisites:
  - T1566
severity_boost:
  T1566: "Chain with T1566 for deeper attack path"
  T1566.001: "Chain with T1566.001 for deeper attack path"
  T1566.003: "Chain with T1566.003 for deeper attack path"
---

# T1566.002 Spearphishing Link

> **Sub-technique of:** T1566

## High-Level Description

Adversaries may send spearphishing emails with a malicious link in an attempt to gain access to victim systems. Spearphishing with a link is a specific variant of spearphishing. It is different from other forms of spearphishing in that it employs the use of links to download malware contained in email, instead of attaching malicious files to the email itself, to avoid defenses that may inspect email attachments. Spearphishing may also involve social engineering techniques, such as posing as a trusted source.

All forms of spearphishing are electronically delivered social engineering targeted at a specific individual, company, or industry. In this case, the malicious emails contain links. Generally, the links will be accompanied by social engineering text and require the user to actively click or copy and paste a URL into a browser, leveraging User Execution. The visited website may compromise the web browser using an exploit, or the user will be prompted to download applications, documents, zip files, or even executables depending on the pretext for the email in the first place.

Adversaries may also include links that are intended to interact directly with an email reader, including embedded images intended to exploit the end system directly. Additionally, adversaries may use seemingly benign links that abuse special characters to mimic legitimate websites (known as an "IDN homograph attack"). URLs may also be obfuscated by taking advantage of quirks in the URL schema, such as the acceptance of integer- or hexadecimal-based hostname formats and the automatic discarding of text before an “@” symbol: for example, `hxxp://google.com@1157586937`.

Adversaries may also utilize links to perform consent phishing/spearphishing campaigns to Steal Application Access Tokens that grant immediate access to the victim environment. For example, a user may be lured into granting adversaries permissions/access via a malicious OAuth 2.0 request URL that when accepted by the user provide permissions/access for malicious applications. These stolen access tokens allow the adversary to perform various actions on behalf of the user via API calls.

Similarly, malicious links may also target device-based authorization, such as OAuth 2.0 device authorization grant flow which is typically used to authenticate devices without UIs/browsers. Known as “device code phishing,” an adversary may send a link that directs the victim to a malicious authorization page where the user is tricked into entering a code/credentials that produces a device token.

## Kill Chain Phase

- Initial Access (TA0001)

**Platforms:** Identity Provider, Linux, macOS, Office Suite, SaaS, Windows

## What to Check

- [ ] Identify if Spearphishing Link technique is applicable to target environment
- [ ] Check Identity Provider systems for indicators of Spearphishing Link
- [ ] Check Linux systems for indicators of Spearphishing Link
- [ ] Check macOS systems for indicators of Spearphishing Link
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Paste and run technique

Tests the **Paste and Run** technique, where users are tricked into running
malicious PowerShell commands by automating the Win+R command to open the
Run dialog and input `encoded PowerShell to execute calc.exe.`

- [Fake CAPTCHA Campaign](https://medium.com/@ahmed.moh.farou2/fake-captcha-campaign-on-arabic-pirated-movie-sites-delivers-lumma-stealer-4f203f7adabf)
- [From Clipboard to Compromise](https://www.proofpoint.com/us/blog/threat-insight/clipboard-compromise-powershell-self-pwn)

**Supported Platforms:** windows

```powershell
# Add user32.dll for keybd_event
Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class K {
        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    }
"@

# Virtual key codes
$VK_LWIN, $VK_R, $KEYDOWN, $KEYUP = 0x5B, 0x52, 0x0000, 0x0002

# Open Run dialog (Win+R)
[K]::keybd_event($VK_LWIN, 0, $KEYDOWN, [UIntPtr]::Zero)
[K]::keybd_event($VK_R, 0, $KEYDOWN, [UIntPtr]::Zero)
[K]::keybd_event($VK_R, 0, $KEYUP, [UIntPtr]::Zero)
[K]::keybd_event($VK_LWIN, 0, $KEYUP, [UIntPtr]::Zero)

# Short delay for Run dialog
Start-Sleep -Milliseconds 500
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("cmd /c powershell -ec " + [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes('#{execution_command}')) + "{ENTER}")
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Spearphishing Link by examining the target platforms (Identity Provider, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1566.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1054 Software Configuration
Use anti-spoofing and email authentication mechanisms to filter messages based on validity checks of the sender domain (using SPF) and integrity of messages (using DKIM). Enabling these mechanisms within an organization (through policies such as DMARC) may enable recipients (intra-org and cross domain) to perform similar message filtering and validation..

Furthermore, policies may enforce / install browser extensions that protect against IDN and homograph attacks.

### M1021 Restrict Web-Based Content
Determine if certain websites that can be used for spearphishing are necessary for business operations and consider blocking access if activity cannot be monitored well or if it poses a significant risk.

### M1047 Audit
Audit applications and their permissions to ensure access to data and resources are limited based upon necessity and principle of least privilege.

### M1018 User Account Management
Azure AD Administrators apply limitations upon the ability for users to grant consent to unfamiliar or unverified third-party applications.

### M1017 User Training
Users can be trained to identify social engineering techniques and spearphishing emails with malicious links which includes phishing for consent with OAuth 2.0. Additionally, users may perform visual checks of the domains they visit; however, homographs in ASCII and in IDN domains and URL schema obfuscation may render manual checks difficult. Use email warning banners to alert users when emails contain links from external senders, prompting them to exercise caution and reducing the likelihood of falling victim to spearphishing attacks. Phishing training and other cybersecurity training may raise awareness to check URLs before visiting the sites.


## Detection

### Detection Strategy for Spearphishing Links


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Spearphishing Link technique applicable | High | Initial Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [ACSC Email Spoofing](https://web.archive.org/web/20210708014107/https://www.cyber.gov.au/sites/default/files/2019-03/spoof_email_sender_policy_framework.pdf)
- [CISA IDN ST05-016](https://us-cert.cisa.gov/ncas/tips/ST05-016)
- [Trend Micro Pawn Storm OAuth 2017](https://blog.trendmicro.com/trendlabs-security-intelligence/pawn-storm-abuses-open-authentication-advanced-social-engineering-attacks)
- [Netskope Device Code Phishing 2021](https://www.netskope.com/blog/new-phishing-attacks-exploiting-oauth-authorization-flows-part-1)
- [Microsoft OAuth 2.0 Consent Phishing 2021](https://www.microsoft.com/security/blog/2021/07/14/microsoft-delivers-comprehensive-solution-to-battle-rise-in-consent-phishing-emails/)
- [Microsoft Anti Spoofing](https://docs.microsoft.com/en-us/microsoft-365/security/office-365-security/anti-spoofing-protection?view=o365-worldwide)
- [Mandiant URL Obfuscation 2023](https://www.mandiant.com/resources/blog/url-obfuscation-schema-abuse)
- [Optiv Device Code Phishing 2021](https://www.optiv.com/insights/source-zero/blog/microsoft-365-oauth-device-code-flow-and-phishing)
- [SecureWorks Device Code Phishing 2021](https://www.secureworks.com/blog/oauths-device-code-flow-abused-in-phishing-attacks)
- [Atomic Red Team - T1566.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1566.002)
- [MITRE ATT&CK - T1566.002](https://attack.mitre.org/techniques/T1566/002)
