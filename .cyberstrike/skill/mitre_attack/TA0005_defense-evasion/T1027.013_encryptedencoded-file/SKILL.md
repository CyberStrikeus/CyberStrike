---
name: "T1027.013_encryptedencoded-file"
description: "Adversaries may encrypt or encode files to obfuscate strings, bytes, and other specific patterns to impede detection."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1027.013
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1027.013"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1027/013"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1027
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
  - T1027.014
  - T1027.015
  - T1027.016
  - T1027.017
prerequisites:
  - T1027
severity_boost:
  T1027: "Chain with T1027 for deeper attack path"
  T1027.001: "Chain with T1027.001 for deeper attack path"
  T1027.002: "Chain with T1027.002 for deeper attack path"
---

# T1027.013 Encrypted/Encoded File

> **Sub-technique of:** T1027

## High-Level Description

Adversaries may encrypt or encode files to obfuscate strings, bytes, and other specific patterns to impede detection. Encrypting and/or encoding file content aims to conceal malicious artifacts within a file used in an intrusion. Many other techniques, such as Software Packing, Steganography, and Embedded Payloads, share this same broad objective. Encrypting and/or encoding files could lead to a lapse in detection of static signatures, only for this malicious content to be revealed (i.e., Deobfuscate/Decode Files or Information) at the time of execution/use.

This type of file obfuscation can be applied to many file artifacts present on victim hosts, such as malware log/configuration and payload files. Files can be encrypted with a hardcoded or user-supplied key, as well as otherwise obfuscated using standard encoding schemes such as Base64.

The entire content of a file may be obfuscated, or just specific functions or values (such as C2 addresses). Encryption and encoding may also be applied in redundant layers for additional protection.

For example, adversaries may abuse password-protected Word documents or self-extracting (SFX) archives as a method of encrypting/encoding a file such as a Phishing payload. These files typically function by attaching the intended archived content to a decompressor stub that is executed when the file is invoked (e.g., User Execution).

Adversaries may also abuse file-specific as well as custom encoding schemes. For example, Byte Order Mark (BOM) headers in text files may be abused to manipulate and obfuscate file content until Command and Scripting Interpreter execution.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Encrypted/Encoded File technique is applicable to target environment
- [ ] Check Linux systems for indicators of Encrypted/Encoded File
- [ ] Check macOS systems for indicators of Encrypted/Encoded File
- [ ] Check Windows systems for indicators of Encrypted/Encoded File
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Decode Eicar File and Write to File

Decode the eicar value, and write it to file, for AV/EDR to try to catch.

**Supported Platforms:** windows, macos, linux

```powershell
$encodedString = "WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo="
$bytes = [System.Convert]::FromBase64String($encodedString)
$decodedString = [System.Text.Encoding]::UTF8.GetString($bytes)
#write the decoded eicar string to file
$decodedString | Out-File $env:temp\T1027.013_decodedEicar.txt
```

### Atomic Test 2: Decrypt Eicar File and Write to File

Decrypt the eicar value, and write it to file, for AV/EDR to try to catch.

**Supported Platforms:** windows, macos, linux

```powershell
$encryptedString = "76492d1116743f0423413b16050a5345MgB8AGkASwA0AHMAbwBXAFoAagBkAFoATABXAGIAdAA5AFcAWAB1AFMANABVAEEAPQA9AHwAZQBjAGMANgAwADQAZAA0AGQAMQAwADUAYgA4ADAAMgBmADkAZgBjADEANQBjAGMANQBiAGMANwA2AGYANQBmADUANABhAGIAYgAyAGMANQA1AGQAMgA5ADEANABkADUAMgBiAGMANgA2AGMAMAAxADUAZABjADAAOABjAGIANAA1ADUANwBjADcAZQBlAGQAYgAxADEAOQA4AGIAMwAwADMANwAwADAANQA2ADQAOAA4ADkAZgA4ADMAZQA4ADgAOQBiAGEAMAA2ADMAMQAyADYAMwBiAGUAMAAxADgANAA0ADYAOAAxADQANQAwAGUANwBkADkANABjADcANQAxADgAYQA2ADMANQA4AGIAYgA1ADkANQAzAGIAMwAxADYAOAAwADQAMgBmADcAZQBjADYANQA5AGIANwBkADUAOAAyAGEAMgBiADEAMQAzAGQANABkADkAZgA3ADMAMABiADgAOQAxADAANAA4ADcAOQA5ADEAYQA1ADYAZAAzADQANwA3AGYANgAyADcAMAAwADEAMQA4ADEAZgA5ADUAYgBmAGYANQA3ADQAZQA4AGUAMAAxADUANwAwAGQANABiADMAMwA2ADgANwA0AGIANwAyADMAMQBhADkAZABhADEANQAzADQAMgAzADEANwAxADAAZgAxADkAYQA1ADEAMQA="
$key = [byte]1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32
$decrypt = ConvertTo-SecureString -String $encryptedString -Key $key
$decryptedString = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($decrypt))
#Write the decrypted eicar string to a file
$decryptedString | Out-File $env:temp\T1027.013_decryptedEicar.txt
```

### Atomic Test 3: Password-Protected ZIP Payload Extraction and Execution

Extracts and executes a script from a password-protected ZIP archive.
This technique is commonly used by malware families like Emotet and QBot to deliver payloads
via email attachments where the password is provided in the message body.
The encrypted ZIP evades static file analysis until extracted at runtime.
Upon successful execution, displays confirmation and system information.

**Supported Platforms:** linux, macos

```bash
echo '#!/bin/bash' > /tmp/art_payload.sh
echo 'echo "T1027.013: Payload extracted from encrypted ZIP"' >> /tmp/art_payload.sh
echo 'echo "Hostname: $(hostname)"' >> /tmp/art_payload.sh
echo 'echo "User: $(whoami)"' >> /tmp/art_payload.sh
echo 'uname -a' >> /tmp/art_payload.sh
cd /tmp && zip -P "#{zip_password}" art_encrypted.zip art_payload.sh
rm /tmp/art_payload.sh
echo "Encrypted ZIP created. Extracting with password..."
unzip -P "#{zip_password}" -o /tmp/art_encrypted.zip -d /tmp/
echo "Executing extracted payload:"
bash /tmp/art_payload.sh
```

**Dependencies:**

- zip and unzip must be installed

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Encrypted/Encoded File by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1027.013 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1049 Antivirus/Antimalware

Anti-virus can be used to automatically detect and quarantine suspicious files, including those with high entropy measurements or with otherwise potentially malicious signs of obfuscation.

### M1040 Behavior Prevention on Endpoint

On Windows 10+, enable Attack Surface Reduction (ASR) rules to block execution of potentially obfuscated scripts.

Security tools should be configured to analyze the encoding properties of files and detect anomalies that deviate from standard encoding practices.

## Detection

### Encrypted or Encoded File Payload Detection Strategy

## Risk Assessment

| Finding                                     | Severity | Impact          |
| ------------------------------------------- | -------- | --------------- |
| Encrypted/Encoded File technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [File obfuscation](https://www.crowdstrike.com/blog/shlayer-malvertising-campaigns-still-using-flash-update-disguise/)
- [SFX - Encrypted/Encoded File](https://www.crowdstrike.com/blog/self-extracting-archives-decoy-files-and-their-hidden-payloads/)
- [Atomic Red Team - T1027.013](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1027.013)
- [MITRE ATT&CK - T1027.013](https://attack.mitre.org/techniques/T1027/013)
