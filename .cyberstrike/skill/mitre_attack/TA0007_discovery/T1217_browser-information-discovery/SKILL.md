---
name: "T1217_browser-information-discovery"
description: "Adversaries may enumerate information about browsers to learn more about compromised environments."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1217
  - discovery
  - linux
  - macos
  - windows
technique_id: "T1217"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1217"
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

# T1217 Browser Information Discovery

## High-Level Description

Adversaries may enumerate information about browsers to learn more about compromised environments. Data saved by browsers (such as bookmarks, accounts, and browsing history) may reveal a variety of personal information about users (e.g., banking sites, relationships/interests, social media, etc.) as well as details about internal network resources such as servers, tools/dashboards, or other related infrastructure.

Browser information may also highlight additional targets after an adversary has access to valid credentials, especially Credentials In Files associated with logins cached by a browser.

Specific storage locations vary based on platform and/or application, but browser information is typically stored in local files and databases (e.g., `%APPDATA%/Google/Chrome`).

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Browser Information Discovery technique is applicable to target environment
- [ ] Check Linux systems for indicators of Browser Information Discovery
- [ ] Check macOS systems for indicators of Browser Information Discovery
- [ ] Check Windows systems for indicators of Browser Information Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: List Mozilla Firefox Bookmark Database Files on FreeBSD/Linux

Searches for Mozilla Firefox's places.sqlite file (on FreeBSD or Linux distributions) that contains bookmarks and lists any found instances to a text file.

**Supported Platforms:** linux

```bash
find / -path "*.mozilla/firefox/*/places.sqlite" 2>/dev/null -exec echo {} >> #{output_file} \;
cat #{output_file} 2>/dev/null
```

### Atomic Test 2: List Mozilla Firefox Bookmark Database Files on macOS

Searches for Mozilla Firefox's places.sqlite file (on macOS) that contains bookmarks and lists any found instances to a text file.

**Supported Platforms:** macos

```bash
find / -path "*/Firefox/Profiles/*/places.sqlite" -exec echo {} >> #{output_file} \;
cat #{output_file} 2>/dev/null
```

### Atomic Test 3: List Google Chrome Bookmark JSON Files on macOS

Searches for Google Chrome's Bookmark file (on macOS) that contains bookmarks in JSON format and lists any found instances to a text file.

**Supported Platforms:** macos

```bash
find / -path "*/Google/Chrome/*/Bookmarks" -exec echo {} >> #{output_file} \;
cat #{output_file} 2>/dev/null
```

### Atomic Test 4: List Google Chromium Bookmark JSON Files on FreeBSD

Searches for Google Chromium's Bookmark file (on FreeBSD) that contains bookmarks in JSON format and lists any found instances to a text file.

**Supported Platforms:** linux

```bash
find / -path "*/.config/chromium/*/Bookmarks" -exec echo {} >> #{output_file} \;
cat #{output_file} 2>/dev/null
```

### Atomic Test 5: List Google Chrome / Opera Bookmarks on Windows with powershell

Searches for Google Chrome's and Opera's Bookmarks file (on Windows distributions) that contains bookmarks.
Upon execution, paths that contain bookmark files will be displayed.

**Supported Platforms:** windows

```powershell
Get-ChildItem -Path C:\Users\ -Filter Bookmarks -Recurse -ErrorAction SilentlyContinue -Force
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Browser Information Discovery by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1217 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Local Browser Artifact Access for Reconnaissance


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Browser Information Discovery technique applicable | High | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Chrome Roaming Profiles](https://support.google.com/chrome/a/answer/7349337)
- [Kaspersky Autofill](https://www.kaspersky.com/blog/browser-data-theft/27871/)
- [Atomic Red Team - T1217](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1217)
- [MITRE ATT&CK - T1217](https://attack.mitre.org/techniques/T1217)
