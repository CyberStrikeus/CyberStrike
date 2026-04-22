---
name: "T1176_software-extensions"
description: "Adversaries may abuse software extensions to establish persistent access to victim systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1176
  - persistence
  - linux
  - macos
  - windows
technique_id: "T1176"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1176"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1176.001
  - T1176.002
prerequisites:
  []
severity_boost:
  T1176.001: "Chain with T1176.001 for deeper attack path"
  T1176.002: "Chain with T1176.002 for deeper attack path"
---

# T1176 Software Extensions

## High-Level Description

Adversaries may abuse software extensions to establish persistent access to victim systems. Software extensions are modular components that enhance or customize the functionality of software applications, including web browsers, Integrated Development Environments (IDEs), and other platforms. Extensions are typically installed via official marketplaces, app stores, or manually loaded by users, and they often inherit the permissions and access levels of the host application. 

 
Malicious extensions can be introduced through various methods, including social engineering, compromised marketplaces, or direct installation by users or by adversaries who have already gained access to a system. Malicious extensions can be named similarly or identically to benign extensions in marketplaces. Security mechanisms in extension marketplaces may be insufficient to detect malicious components, allowing adversaries to bypass automated scanners or exploit trust established during the installation process. Adversaries may also abuse benign extensions to achieve their objectives, such as using legitimate functionality to tunnel data or bypass security controls. 

The modular nature of extensions and their integration with host applications make them an attractive target for adversaries seeking to exploit trusted software ecosystems. Detection can be challenging due to the inherent trust placed in extensions during installation and their ability to blend into normal application workflows.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Software Extensions technique is applicable to target environment
- [ ] Check Linux systems for indicators of Software Extensions
- [ ] Check macOS systems for indicators of Software Extensions
- [ ] Check Windows systems for indicators of Software Extensions
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Chrome/Chromium (Developer Mode)

Turn on Chrome/Chromium developer mode and Load Extension found in the src directory

**Supported Platforms:** linux, windows, macos

### Atomic Test 2: Firefox

Create a file called test.wma, with the duration of 30 seconds

**Supported Platforms:** linux, windows, macos

### Atomic Test 3: Edge Chromium Addon - VPN

Adversaries may use VPN extensions in an attempt to hide traffic sent from a compromised host. This will install one (of many) available VPNS in the Edge add-on store.

**Supported Platforms:** windows, macos

### Atomic Test 4: Google Chrome Load Unpacked Extension With Command Line

This test loads an unpacked extension in Google Chrome with the `--load-extension` parameter. This technique was previously used by the Grandoreiro malware to load a malicious extension that would capture the browsing history, steal cookies and other user information. Other malwares also leverage this technique to hijack searches, steal passwords, inject ads, and more.

References:
https://attack.mitre.org/techniques/T1176/
https://securityintelligence.com/posts/grandoreiro-malware-now-targeting-banks-in-spain/

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
# Chromium
$chromium =  "https://commondatastorage.googleapis.com/chromium-browser-snapshots/Win_x64/1153778/chrome-win.zip"

# uBlock Origin Lite to test side-loading
$extension = "https://github.com/uBlockOrigin/uBOL-home/releases/download/uBOLite_2024.11.25.1376/uBOLite_2024.11.25.1376.chromium.mv3.zip"

Set-Location "#{working_dir}"

Set-Variable ProgressPreference SilentlyContinue
Invoke-WebRequest -URI $chromium -OutFile "#{working_dir}\chrome.zip"
Invoke-WebRequest -URI $extension -OutFile "#{working_dir}\extension.zip"


Expand-Archive chrome.zip -DestinationPath "#{working_dir}" -Force
Expand-Archive extension.zip -Force

Start-Process .\chrome-win\chrome.exe --load-extension="#{working_dir}\extension\" -PassThru
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Software Extensions by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1176 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1033 Limit Software Installation
Only install extensions from trusted sources that can be verified.

### M1047 Audit
Ensure extensions that are installed are the intended ones, as many malicious extensions may masquerade as legitimate ones.

### M1017 User Training
Train users to minimize extension use, and to only install trusted extensions.

### M1051 Update Software
Ensure operating systems and software are using the most current version.

### M1038 Execution Prevention
Set an extension allow or deny list as appropriate for your security policy.


## Detection

### Detection of Malicious or Unauthorized Software Extensions


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Software Extensions technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Abramovsky VSCode Security](https://blog.checkpoint.com/securing-the-cloud/malicious-vscode-extensions-with-more-than-45k-downloads-steal-pii-and-enable-backdoors/)
- [xorrior chrome extensions macOS](https://www.xorrior.com/No-Place-Like-Chrome/)
- [Chrome Extension C2 Malware](https://web.archive.org/web/20240608001937/https://kjaer.io/extension-malware/)
- [Atomic Red Team - T1176](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1176)
- [MITRE ATT&CK - T1176](https://attack.mitre.org/techniques/T1176)
