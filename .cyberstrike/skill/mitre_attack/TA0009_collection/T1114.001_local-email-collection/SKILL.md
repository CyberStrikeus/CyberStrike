---
name: "T1114.001_local-email-collection"
description: "Adversaries may target user email on local systems to collect sensitive information."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1114.001
  - collection
  - windows
  - sub-technique
technique_id: "T1114.001"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1114/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1114
  - T1114.002
  - T1114.003
prerequisites:
  - T1114
severity_boost:
  T1114: "Chain with T1114 for deeper attack path"
  T1114.002: "Chain with T1114.002 for deeper attack path"
  T1114.003: "Chain with T1114.003 for deeper attack path"
---

# T1114.001 Local Email Collection

> **Sub-technique of:** T1114

## High-Level Description

Adversaries may target user email on local systems to collect sensitive information. Files containing email data can be acquired from a user’s local system, such as Outlook storage or cache files.

Outlook stores data locally in offline data files with an extension of .ost. Outlook 2010 and later supports .ost file sizes up to 50GB, while earlier versions of Outlook support up to 20GB. IMAP accounts in Outlook 2013 (and earlier) and POP accounts use Outlook Data Files (.pst) as opposed to .ost, whereas IMAP accounts in Outlook 2016 (and later) use .ost files. Both types of Outlook data files are typically stored in `C:\Users\<username>\Documents\Outlook Files` or `C:\Users\<username>\AppData\Local\Microsoft\Outlook`.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Windows

## What to Check

- [ ] Identify if Local Email Collection technique is applicable to target environment
- [ ] Check Windows systems for indicators of Local Email Collection
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Email Collection with PowerShell Get-Inbox

Search through local Outlook installation, extract mail, compress the contents, and saves everything to a directory for later exfiltration.
Successful execution will produce stdout message stating "Please be patient, this may take some time...". Upon completion, final output will be a mail.csv file.

Note: Outlook is required, but no email account necessary to produce artifacts.

**Supported Platforms:** windows

```powershell
powershell -executionpolicy bypass -command "#{file_path}\Get-Inbox.ps1" -file #{output_file}
```

**Dependencies:**

- Get-Inbox.ps1 must be located at #{file_path}

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Local Email Collection by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1114.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1060 Out-of-Band Communications Channel

Implement secure out-of-band alerts to notify security teams of unusual local email activities, such as mass forwarding or large attachments being sent, indicating potential data exfiltration attempts.

### M1041 Encrypt Sensitive Information

Use of encryption provides an added layer of security to sensitive information sent over email. Encryption using public key cryptography requires the adversary to obtain the private certificate along with an encryption key to decrypt messages.

## Detection

### Detect Local Email Collection via Outlook Data File Access and Command Line Tooling

## Risk Assessment

| Finding                                     | Severity | Impact     |
| ------------------------------------------- | -------- | ---------- |
| Local Email Collection technique applicable | Low      | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Outlook File Sizes](https://practical365.com/clients/office-365-proplus/outlook-cached-mode-ost-file-sizes/)
- [Microsoft Outlook Files](https://support.office.com/en-us/article/introduction-to-outlook-data-files-pst-and-ost-222eaf92-a995-45d9-bde2-f331f60e2790)
- [Atomic Red Team - T1114.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1114.001)
- [MITRE ATT&CK - T1114.001](https://attack.mitre.org/techniques/T1114/001)
