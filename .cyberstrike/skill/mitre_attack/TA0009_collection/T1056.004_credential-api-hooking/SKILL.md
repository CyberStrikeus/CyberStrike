---
name: "T1056.004_credential-api-hooking"
description: "Adversaries may hook into Windows application programming interface (API) functions and Linux system functions to collect user credentials."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1056.004
  - collection
  - credential-access
  - windows
  - linux
  - macos
  - sub-technique
technique_id: "T1056.004"
tactic: "collection"
all_tactics:
  - collection
  - credential-access
platforms:
  - Windows
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1056/004"
tech_stack:
  - windows
  - linux
  - macos
cwe_ids:
  - CWE-200
chains_with:
  - T1056
  - T1056.001
  - T1056.002
  - T1056.003
prerequisites:
  - T1056
severity_boost:
  T1056: "Chain with T1056 for deeper attack path"
  T1056.001: "Chain with T1056.001 for deeper attack path"
  T1056.002: "Chain with T1056.002 for deeper attack path"
---

# T1056.004 Credential API Hooking

> **Sub-technique of:** T1056

## High-Level Description

Adversaries may hook into Windows application programming interface (API) functions and Linux system functions to collect user credentials. Malicious hooking mechanisms may capture API or function calls that include parameters that reveal user authentication credentials. Unlike Keylogging, this technique focuses specifically on API functions that include parameters that reveal user credentials.

In Windows, hooking involves redirecting calls to these functions and can be implemented via:

- **Hooks procedures**, which intercept and execute designated code in response to events such as messages, keystrokes, and mouse inputs.
- **Import address table (IAT) hooking**, which use modifications to a process’s IAT, where pointers to imported API functions are stored.
- **Inline hooking**, which overwrites the first bytes in an API function to redirect code flow.

In Linux and macOS, adversaries may hook into system functions via the `LD_PRELOAD` (Linux) or `DYLD_INSERT_LIBRARIES` (macOS) environment variables, which enables loading shared libraries into a program’s address space. For example, an adversary may capture credentials by hooking into the `libc read` function leveraged by SSH or SCP.

## Kill Chain Phase

- Collection (TA0009)
- Credential Access (TA0006)

**Platforms:** Windows, Linux, macOS

## What to Check

- [ ] Identify if Credential API Hooking technique is applicable to target environment
- [ ] Check Windows systems for indicators of Credential API Hooking
- [ ] Check Linux systems for indicators of Credential API Hooking
- [ ] Check macOS systems for indicators of Credential API Hooking
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Hook PowerShell TLS Encrypt/Decrypt Messages

Hooks functions in PowerShell to read TLS Communications

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
mavinject $pid /INJECTRUNNING "#{file_name}"
Invoke-WebRequest #{server_name} -UseBasicParsing
```

**Dependencies:**

- T1056.004x64.dll must exist on disk at specified location (#{file_name})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Credential API Hooking by examining the target platforms (Windows, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1056.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Credential Harvesting via API Hooking

## Risk Assessment

| Finding                                     | Severity | Impact     |
| ------------------------------------------- | -------- | ---------- |
| Credential API Hooking technique applicable | High     | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [EyeofRa Detecting Hooking June 2017](https://eyeofrablog.wordpress.com/2017/06/27/windows-keylogger-part-2-defense-against-user-land/)
- [Zairon Hooking Dec 2006](https://zairon.wordpress.com/2006/12/06/any-application-defined-hook-procedure-on-my-machine/)
- [GMER Rootkits](http://www.gmer.net/)
- [MWRInfoSecurity Dynamic Hooking 2015](https://www.mwrinfosecurity.com/our-thinking/dynamic-hooking-techniques-user-mode/)
- [Elastic Process Injection July 2017](https://www.endgame.com/blog/technical-blog/ten-process-injection-techniques-technical-survey-common-and-trending-process)
- [Intezer Symbiote 2022](https://intezer.com/blog/research/new-linux-threat-symbiote/)
- [HighTech Bridge Inline Hooking Sept 2011](https://www.scribd.com/document/68671361/Inline-Hooking-in-Windows)
- [Microsoft TrojanSpy:Win32/Ursnif.gen!I Sept 2017](https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=TrojanSpy:Win32/Ursnif.gen!I&threatId=-2147336918)
- [Microsoft Hook Overview](https://msdn.microsoft.com/library/windows/desktop/ms644959.aspx)
- [Microsoft Process Snapshot](https://msdn.microsoft.com/library/windows/desktop/ms686701.aspx)
- [PreKageo Winhook Jul 2011](https://github.com/prekageo/winhook)
- [Jay GetHooks Sept 2011](https://github.com/jay/gethooks)
- [StackExchange Hooks Jul 2012](https://security.stackexchange.com/questions/17904/what-are-the-methods-to-find-hooked-functions-and-apis)
- [Adlice Software IAT Hooks Oct 2014](https://www.adlice.com/userland-rootkits-part-1-iat-hooks/)
- [Volatility Detecting Hooks Sept 2012](https://volatility-labs.blogspot.com/2012/09/movp-31-detecting-malware-hooks-in.html)
- [Atomic Red Team - T1056.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1056.004)
- [MITRE ATT&CK - T1056.004](https://attack.mitre.org/techniques/T1056/004)
