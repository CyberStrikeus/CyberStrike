---
name: "T1027.006_html-smuggling"
description: "Adversaries may smuggle data and files past content filters by hiding malicious payloads inside of seemingly benign HTML files."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1027.006
  - defense-evasion
  - windows
  - linux
  - macos
  - sub-technique
technique_id: "T1027.006"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1027/006"
tech_stack:
  - windows
  - linux
  - macos
cwe_ids:
  - CWE-693
chains_with:
  - T1027
  - T1027.001
  - T1027.002
  - T1027.003
  - T1027.004
  - T1027.005
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
prerequisites:
  - T1027
severity_boost:
  T1027: "Chain with T1027 for deeper attack path"
  T1027.001: "Chain with T1027.001 for deeper attack path"
  T1027.002: "Chain with T1027.002 for deeper attack path"
---

# T1027.006 HTML Smuggling

> **Sub-technique of:** T1027

## High-Level Description

Adversaries may smuggle data and files past content filters by hiding malicious payloads inside of seemingly benign HTML files. HTML documents can store large binary objects known as JavaScript Blobs (immutable data that represents raw bytes) that can later be constructed into file-like objects. Data may also be stored in Data URLs, which enable embedding media type or MIME files inline of HTML documents. HTML5 also introduced a download attribute that may be used to initiate file downloads.

Adversaries may deliver payloads to victims that bypass security controls through HTML Smuggling by abusing JavaScript Blobs and/or HTML5 download attributes. Security controls such as web content filters may not identify smuggled malicious files inside of HTML/JS files, as the content may be based on typically benign MIME types such as <code>text/plain</code> and/or <code>text/html</code>. Malicious files or data can be obfuscated and hidden inside of HTML files through Data URLs and/or JavaScript Blobs and can be deobfuscated when they reach the victim (i.e. Deobfuscate/Decode Files or Information), potentially bypassing content filters.

For example, JavaScript Blobs can be abused to dynamically generate malicious files in the victim machine and may be dropped to disk by abusing JavaScript functions such as <code>msSaveBlob</code>.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows, Linux, macOS

## What to Check

- [ ] Identify if HTML Smuggling technique is applicable to target environment
- [ ] Check Windows systems for indicators of HTML Smuggling
- [ ] Check Linux systems for indicators of HTML Smuggling
- [ ] Check macOS systems for indicators of HTML Smuggling
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: HTML Smuggling Remote Payload

The HTML file will download an ISO file from [T1553.005](https://github.com/redcanaryco/atomic-red-team/blob/d0dad62dbcae9c60c519368e82c196a3db577055/atomics/T1553.005/bin/FeelTheBurn.iso) without user interaction.
The HTML file is based off of the work from [Stan Hegt](https://outflank.nl/blog/2018/08/14/html-smuggling-explained/)

**Supported Platforms:** windows

```powershell
& "PathToAtomicsFolder\T1027.006\bin\T1027_006_remote.html"
```

**Dependencies:**

- T1027_006_remote.html must exist on disk at specified at PathToAtomicsFolder\T1027.006\bin\T1027_006_Remote.html

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to HTML Smuggling by examining the target platforms (Windows, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1027.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1048 Application Isolation and Sandboxing

Use Browser Extensions or Built-in Security Tools that:

- Monitor JavaScript API calls such as `Blob`, `URL.createObjectURL,` and `msSaveOrOpenBlob`
- Intercept and analyze HTML5 `download` attributes for suspicious payload generation
- Alert or block behaviors that match known HTML smuggling patterns (e.g., blob-to-disk payload construction)

Apply Content Security Policy (CSP) headers to:

- Restrict inline JavaScript and dynamic script generation
- Disallow downloads from unauthorized sources or blob URIs
- Prevent cross-origin resource sharing (CORS) abuse commonly used in smuggling chains

Enable or enforce enterprise browser security controls, such as:

- Endpoint's Network Protection and Attack Surface Reduction (ASR) rules, which can block Office and browser processes from creating child processes or writing to disk in suspicious ways
- Google Chrome Enterprise Policies, which can control file download behavior, restrict extensions, and isolate risky browsing environments

Deploy browser sandboxing solutions that can isolate JavaScript execution environments and enforce behavioral policy restrictions

## Detection

### Detection Strategy for HTML Smuggling via JavaScript Blob + Dynamic File Drop

## Risk Assessment

| Finding                             | Severity | Impact          |
| ----------------------------------- | -------- | --------------- |
| HTML Smuggling technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Outlflank HTML Smuggling 2018](https://outflank.nl/blog/2018/08/14/html-smuggling-explained/)
- [MSTIC NOBELIUM May 2021](https://www.microsoft.com/security/blog/2021/05/27/new-sophisticated-email-based-attack-from-nobelium/)
- [HTML Smuggling Menlo Security 2020](https://www.menlosecurity.com/blog/new-attack-alert-duri)
- [nccgroup Smuggling HTA 2017](https://www.nccgroup.com/us/research-blog/smuggling-hta-files-in-internet-exploreredge/)
- [Atomic Red Team - T1027.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1027.006)
- [MITRE ATT&CK - T1027.006](https://attack.mitre.org/techniques/T1027/006)
