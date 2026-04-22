---
name: "T1218.008_odbcconf"
description: "Adversaries may abuse odbcconf.exe to proxy execution of malicious payloads."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1218.008
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1218.008"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1218/008"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1218
  - T1218.001
  - T1218.002
  - T1218.003
  - T1218.004
  - T1218.005
  - T1218.007
  - T1218.009
  - T1218.010
  - T1218.011
  - T1218.012
  - T1218.013
  - T1218.014
  - T1218.015
prerequisites:
  - T1218
severity_boost:
  T1218: "Chain with T1218 for deeper attack path"
  T1218.001: "Chain with T1218.001 for deeper attack path"
  T1218.002: "Chain with T1218.002 for deeper attack path"
---

# T1218.008 Odbcconf

> **Sub-technique of:** T1218

## High-Level Description

Adversaries may abuse odbcconf.exe to proxy execution of malicious payloads. Odbcconf.exe is a Windows utility that allows you to configure Open Database Connectivity (ODBC) drivers and data source names. The Odbcconf.exe binary may be digitally signed by Microsoft.

Adversaries may abuse odbcconf.exe to bypass application control solutions that do not account for its potential abuse. Similar to Regsvr32, odbcconf.exe has a <code>REGSVR</code> flag that can be misused to execute DLLs (ex: <code>odbcconf.exe /S /A &lbrace;REGSVR "C:\Users\Public\file.dll"&rbrace;</code>).

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Odbcconf technique is applicable to target environment
- [ ] Check Windows systems for indicators of Odbcconf
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Odbcconf.exe - Execute Arbitrary DLL

Execute arbitrary DLL file stored locally.

**Supported Platforms:** windows

```cmd
odbcconf.exe /S /A {REGSVR "#{dll_payload}"}
```

**Dependencies:**

- T1218-2.dll must exist on disk at specified location (#{dll_payload})

### Atomic Test 2: Odbcconf.exe - Load Response File

Execute arbitrary response file that will spawn PowerShell.exe.
Source files: https://github.com/woanware/application-restriction-bypasses

**Supported Platforms:** windows

```cmd
cd "#{rsp_file_path}"
odbcconf.exe -f "#{rsp_file_name}"
```

**Dependencies:**

- T1218.008.rsp must exist on disk at specified location (#{rsp_file_path}#{rsp_file_name})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Odbcconf by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1218.008 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

Odbcconf.exe may not be necessary within a given environment.

### M1038 Execution Prevention

Use application control configured to block execution of Odbcconf.exe if it is not required for a given system or network to prevent potential misuse by adversaries.

## Detection

### Detecting Odbcconf Proxy Execution of Malicious DLLs

## Risk Assessment

| Finding                       | Severity | Impact          |
| ----------------------------- | -------- | --------------- |
| Odbcconf technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Microsoft odbcconf.exe](https://docs.microsoft.com/en-us/sql/odbc/odbcconf-exe?view=sql-server-2017)
- [LOLBAS Odbcconf](https://lolbas-project.github.io/lolbas/Binaries/Odbcconf/)
- [TrendMicro Squiblydoo Aug 2017](https://blog.trendmicro.com/trendlabs-security-intelligence/backdoor-carrying-emails-set-sights-on-russian-speaking-businesses/)
- [TrendMicro Cobalt Group Nov 2017](https://blog.trendmicro.com/trendlabs-security-intelligence/cobalt-spam-runs-use-macros-cve-2017-8759-exploit/)
- [Atomic Red Team - T1218.008](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1218.008)
- [MITRE ATT&CK - T1218.008](https://attack.mitre.org/techniques/T1218/008)
