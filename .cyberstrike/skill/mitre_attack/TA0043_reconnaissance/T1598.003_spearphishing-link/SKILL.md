---
name: "T1598.003_spearphishing-link"
description: "Adversaries may send spearphishing messages with a malicious link to elicit sensitive information that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1598.003
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1598.003"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1598/003"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1598
  - T1598.001
  - T1598.002
  - T1598.004
prerequisites:
  - T1598
severity_boost:
  T1598: "Chain with T1598 for deeper attack path"
  T1598.001: "Chain with T1598.001 for deeper attack path"
  T1598.002: "Chain with T1598.002 for deeper attack path"
---

# T1598.003 Spearphishing Link

> **Sub-technique of:** T1598

## High-Level Description

Adversaries may send spearphishing messages with a malicious link to elicit sensitive information that can be used during targeting. Spearphishing for information is an attempt to trick targets into divulging information, frequently credentials or other actionable information. Spearphishing for information frequently involves social engineering techniques, such as posing as a source with a reason to collect information (ex: Establish Accounts or Compromise Accounts) and/or sending multiple, seemingly urgent messages.

All forms of spearphishing are electronically delivered social engineering targeted at a specific individual, company, or industry. In this scenario, the malicious emails contain links generally accompanied by social engineering text to coax the user to actively click or copy and paste a URL into a browser. The given website may be a clone of a legitimate site (such as an online or corporate login portal) or may closely resemble a legitimate site in appearance and have a URL containing elements from the real site. URLs may also be obfuscated by taking advantage of quirks in the URL schema, such as the acceptance of integer- or hexadecimal-based hostname formats and the automatic discarding of text before an “@” symbol: for example, `hxxp://google.com@1157586937`.

Adversaries may also embed “tracking pixels,” "web bugs," or "web beacons" within phishing messages to verify the receipt of an email, while also potentially profiling and tracking victim information such as IP address. These mechanisms often appear as small images (typically one pixel in size) or otherwise obfuscated objects and are typically delivered as HTML code containing a link to a remote server.

Adversaries may also be able to spoof a complete website using what is known as a "browser-in-the-browser" (BitB) attack. By generating a fake browser popup window with an HTML-based address bar that appears to contain a legitimate URL (such as an authentication portal), they may be able to prompt users to enter their credentials while bypassing typical URL verification methods.

Adversaries can use phishing kits such as `EvilProxy` and `Evilginx2` to perform adversary-in-the-middle phishing by proxying the connection between the victim and the legitimate website. On a successful login, the victim is redirected to the legitimate website, while the adversary captures their session cookie (i.e., Steal Web Session Cookie) in addition to their username and password. This may enable the adversary to then bypass MFA via Web Session Cookie.

Adversaries may also send a malicious link in the form of Quick Response (QR) Codes (also known as “quishing”). These links may direct a victim to a credential phishing page. By using a QR code, the URL may not be exposed in the email and may thus go undetected by most automated email security scans. These QR codes may be scanned by or delivered directly to a user’s mobile device (i.e., Phishing), which may be less secure in several relevant ways. For example, mobile users may not be able to notice minor differences between genuine and credential harvesting websites due to mobile’s smaller form factor.

From the fake website, information is gathered in web forms and sent to the adversary. Adversaries may also use information from previous reconnaissance efforts (ex: Search Open Websites/Domains or Search Victim-Owned Websites) to craft persuasive and believable lures.

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Spearphishing Link technique is applicable to target environment
- [ ] Check PRE systems for indicators of Spearphishing Link
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Spearphishing Link by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1598.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1017 User Training

Users can be trained to identify social engineering techniques and spearphishing attempts. Additionally, users may perform visual checks of the domains they visit; however, homographs in ASCII and in IDN domains and URL schema obfuscation may render manual checks difficult. Phishing training and other cybersecurity training may raise awareness to check URLs before visiting the sites.

### M1054 Software Configuration

Use anti-spoofing and email authentication mechanisms to filter messages based on validity checks of the sender domain (using SPF) and integrity of messages (using DKIM). Enabling these mechanisms within an organization (through policies such as DMARC) may enable recipients (intra-org and cross domain) to perform similar message filtering and validation.

Furthermore, policies may enforce / install browser extensions that protect against IDN and homograph attacks. Browser password managers may also be configured to only populate credential fields when the URL matches that of the original, legitimate site.

## Detection

### Detection of Spearphishing Link

## Risk Assessment

| Finding                                 | Severity | Impact         |
| --------------------------------------- | -------- | -------------- |
| Spearphishing Link technique applicable | High     | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [ACSC Email Spoofing](https://web.archive.org/web/20210708014107/https://www.cyber.gov.au/sites/default/files/2019-03/spoof_email_sender_policy_framework.pdf)
- [TrendMictro Phishing](https://www.trendmicro.com/en_us/research/20/i/tricky-forms-of-phishing.html)
- [IAPP](https://iapp.org/resources/article/web-beacon/)
- [QR-campaign-energy-firm](https://therecord.media/phishing-campaign-used-qr-codes-to-target-energy-firm)
- [PCMag FakeLogin](https://www.pcmag.com/news/hackers-try-to-phish-united-nations-staffers-with-fake-login-pages)
- [Microsoft Anti Spoofing](https://docs.microsoft.com/en-us/microsoft-365/security/office-365-security/anti-spoofing-protection?view=o365-worldwide)
- [Mr. D0x BitB 2022](https://mrd0x.com/browser-in-the-browser-phishing-attack/)
- [Mandiant URL Obfuscation 2023](https://www.mandiant.com/resources/blog/url-obfuscation-schema-abuse)
- [NIST Web Bug](https://csrc.nist.gov/glossary/term/web_bug)
- [Proofpoint Human Factor](https://www.proofpoint.com/sites/default/files/threat-reports/pfpt-us-tr-human-factor-report.pdf)
- [Ryte Wiki](https://en.ryte.com/wiki/Tracking_Pixel/)
- [qr-phish-agriculture](https://www.proofpoint.com/us/blog/email-and-cloud-threats/cybersecurity-stop-month-qr-code-phishing)
- [ZScaler BitB 2020](https://www.zscaler.com/blogs/security-research/fake-sites-stealing-steam-credentials)
- [Atomic Red Team - T1598.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1598.003)
- [MITRE ATT&CK - T1598.003](https://attack.mitre.org/techniques/T1598/003)
