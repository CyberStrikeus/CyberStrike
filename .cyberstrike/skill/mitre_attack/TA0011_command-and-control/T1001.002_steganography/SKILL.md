---
name: "T1001.002_steganography"
description: "Adversaries may use steganographic techniques to hide command and control traffic to make detection efforts more difficult."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1001.002
  - command-and-control
  - linux
  - macos
  - windows
  - esxi
  - sub-technique
technique_id: "T1001.002"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Linux
  - macOS
  - Windows
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1001/002"
tech_stack:
  - linux
  - macos
  - windows
  - esxi
cwe_ids:
  - CWE-300
chains_with:
  - T1001
  - T1001.001
  - T1001.003
prerequisites:
  - T1001
severity_boost:
  T1001: "Chain with T1001 for deeper attack path"
  T1001.001: "Chain with T1001.001 for deeper attack path"
  T1001.003: "Chain with T1001.003 for deeper attack path"
---

# T1001.002 Steganography

> **Sub-technique of:** T1001

## High-Level Description

Adversaries may use steganographic techniques to hide command and control traffic to make detection efforts more difficult. Steganographic techniques can be used to hide data in digital messages that are transferred between systems. This hidden information can be used for command and control of compromised systems. In some cases, the passing of files embedded using steganography, such as image or document files, can be used for command and control.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** Linux, macOS, Windows, ESXi

## What to Check

- [ ] Identify if Steganography technique is applicable to target environment
- [ ] Check Linux systems for indicators of Steganography
- [ ] Check macOS systems for indicators of Steganography
- [ ] Check Windows systems for indicators of Steganography
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Steganographic Tarball Embedding

This atomic test, named "Steganographic Tarball Embedding", simulates the technique of data obfuscation via steganography by embedding a tar archive file (tarball) 
within an image.

The test begins by ensuring the availability of the image file and the tarball file containing data . It then generates random passwords and saves them to a 
file. Subsequently, the tarball file is created, containing the passwords file. The test executor command reads the contents of the image 
file and the tarball file as byte arrays and appends them together to form a new image file. This process effectively embeds the tarball 
file within the image, utilizing steganography techniques for data obfuscation.

This atomic test simulates the technique of data obfuscation via steganography, enabling attackers to clandestinely transfer files across systems undetected. 
By embedding the tarball file within the image, adversaries can obscure their activities, facilitating covert communication and data exfiltration.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Get-Content "#{image_file}", "#{tar_file}" -Encoding byte -ReadCount 0 | Set-Content "#{new_image_file}" -Encoding byte
```

**Dependencies:**
- Image file must exist
- File to hide within tarz file must exist
- Tarz file to embed in image must exist

### Atomic Test 2: Embedded Script in Image Execution via Extract-Invoke-PSImage

This atomic test demonstrates the technique of data obfuscation via steganography, where a PowerShell script is concealed within an image file. 
The PowerShell script is embedded using steganography techniques, making it undetectable by traditional security measures. The script is hidden 
within the pixels of the image, enabling attackers to covertly transfer and execute malicious code across systems.

The test begins by ensuring the availability of the malicious image file and the Extract-Invoke-PSImage script. The test proceeds to extract the hidden 
PowerShell script (decoded.ps1) from the image file using the Extract-Invoke-PSImage tool. The extracted script is then decoded from base64 encoding and saved as a 
separate PowerShell (textExtraction.ps1). Consequently, the textExtraction.ps1 script is executed.

In the case of this atomic test, the malicious image file which is downloaded has the powershell command Start-Process notepad embedded within in base64. This
is done to emulate an attackers behaviour in the case they were to execute malware embedded within the image file.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
cd "PathToAtomicsFolder\ExternalPayloads\"
Import-Module .\Extract-Invoke-PSImage.ps1
$extractedScript=Extract-Invoke-PSImage -Image "#{image_file}" -Out "$HOME\result.ps1"
$scriptContent = Get-Content "$HOME\result.ps1" -Raw
$base64Pattern = "(?<=^|[^A-Za-z0-9+/])(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(==)?|[A-Za-z0-9+/]{3}=)?(?=$|[^A-Za-z0-9+/])"
$base64Strings = [regex]::Matches($scriptContent, $base64Pattern) | ForEach-Object { $_.Value }
$base64Strings | Set-Content "$HOME\decoded.ps1"
$decodedContent = Get-Content "$HOME\decoded.ps1" -Raw
$decodedText = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($decodedContent))
$textPattern = '^.+'  
$textMatches = [regex]::Matches($decodedText, $textPattern) | ForEach-Object { $_.Value }
$scriptPath = "$HOME\textExtraction.ps1"
$textMatches -join '' | Set-Content -Path $scriptPath
. "$HOME\textExtraction.ps1"
```

**Dependencies:**
- Image file must exist
- Extract-Invoke-PSImage must exist

### Atomic Test 3: Execute Embedded Script in Image via Steganography

This atomic test demonstrates the execution of an embedded script in an image file using steganography techniques. The script is first encoded in base64 and then embedded within the pixels of the image. The modified image is created, and the script is extracted and executed on the target system.

**Supported Platforms:** linux

```bash
cat "#{script}" | base64 | xxd -p | sed 's/../& /g' | xargs -n1 | xxd -r -p | cat "#{image}" - > "#{evil_image}"; strings "#{evil_image}" | tail -n 1 | base64 -d | sh
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Steganography by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1001.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1031 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate some obfuscation activity at the network level.


## Detection

### Detecting Steganographic Command and Control via File + Network Correlation


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Steganography technique applicable | Low | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Atomic Red Team - T1001.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1001.002)
- [MITRE ATT&CK - T1001.002](https://attack.mitre.org/techniques/T1001/002)
