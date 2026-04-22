---
name: "T1059.007_javascript"
description: "Adversaries may abuse various implementations of JavaScript for execution."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1059.007
  - execution
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1059.007"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1059/007"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-94
chains_with:
  - T1059
  - T1059.001
  - T1059.002
  - T1059.003
  - T1059.004
  - T1059.005
  - T1059.006
  - T1059.008
  - T1059.009
  - T1059.010
  - T1059.011
  - T1059.012
  - T1059.013
prerequisites:
  - T1059
severity_boost:
  T1059: "Chain with T1059 for deeper attack path"
  T1059.001: "Chain with T1059.001 for deeper attack path"
  T1059.002: "Chain with T1059.002 for deeper attack path"
---

# T1059.007 JavaScript

> **Sub-technique of:** T1059

## High-Level Description

Adversaries may abuse various implementations of JavaScript for execution. JavaScript (JS) is a platform-independent scripting language (compiled just-in-time at runtime) commonly associated with scripts in webpages, though JS can be executed in runtime environments outside the browser.

JScript is the Microsoft implementation of the same scripting standard. JScript is interpreted via the Windows Script engine and thus integrated with many components of Windows such as the Component Object Model and Internet Explorer HTML Application (HTA) pages.

JavaScript for Automation (JXA) is a macOS scripting language based on JavaScript, included as part of Apple’s Open Scripting Architecture (OSA), that was introduced in OSX 10.10. Apple’s OSA provides scripting capabilities to control applications, interface with the operating system, and bridge access into the rest of Apple’s internal APIs. As of OSX 10.10, OSA only supports two languages, JXA and AppleScript. Scripts can be executed via the command line utility <code>osascript</code>, they can be compiled into applications or script files via <code>osacompile</code>, and they can be compiled and executed in memory of other programs by leveraging the OSAKit Framework.

Adversaries may abuse various implementations of JavaScript to execute various behaviors. Common uses include hosting malicious scripts on websites as part of a Drive-by Compromise or downloading and executing these script files as secondary payloads. Since these payloads are text-based, it is also very common for adversaries to obfuscate their content as part of Obfuscated Files or Information.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if JavaScript technique is applicable to target environment
- [ ] Check Linux systems for indicators of JavaScript
- [ ] Check macOS systems for indicators of JavaScript
- [ ] Check Windows systems for indicators of JavaScript
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: JScript execution to gather local computer information via cscript

JScript execution test, execute JScript via cscript command. When successful, system information will be written to $env:TEMP\T1059.007.out.txt

**Supported Platforms:** windows

```cmd
cscript "#{jscript}" > %tmp%\T1059.007.out.txt
```

**Dependencies:**

- Sample script must exist on disk at specified location (#{jscript})

### Atomic Test 2: JScript execution to gather local computer information via wscript

JScript execution test, execute JScript via wscript command. When successful, system information will be shown with four message boxes.

**Supported Platforms:** windows

```cmd
wscript "#{jscript}"
```

**Dependencies:**

- Sample script must exist on disk at specified location (#{jscript})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to JavaScript by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1059.007 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint

On Windows 10, enable Attack Surface Reduction (ASR) rules to prevent JavaScript scripts from executing potentially malicious downloaded content .

### M1038 Execution Prevention

Denylist scripting where appropriate.

### M1042 Disable or Remove Feature or Program

Turn off or restrict access to unneeded scripting components.

### M1021 Restrict Web-Based Content

Script blocking extensions can help prevent the execution of JavaScript and HTA files that may commonly be used during the exploitation process. For malicious code served up through ads, adblockers can help prevent that code from executing in the first place.

## Detection

### Cross-Platform Detection of JavaScript Execution Abuse

## Risk Assessment

| Finding                         | Severity | Impact    |
| ------------------------------- | -------- | --------- |
| JavaScript technique applicable | Medium   | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Apple About Mac Scripting 2016](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/index.html)
- [MDSec macOS JXA and VSCode](https://www.mdsec.co.uk/2021/01/macos-post-exploitation-shenanigans-with-vscode-extensions/)
- [Microsoft JScript 2007](https://docs.microsoft.com/archive/blogs/gauravseth/the-world-of-jscript-javascript-ecmascript)
- [Microsoft Windows Scripts](https://docs.microsoft.com/scripting/winscript/windows-script-interfaces)
- [JScrip May 2018](https://docs.microsoft.com/windows/win32/com/translating-to-jscript)
- [NodeJS](https://nodejs.org/)
- [SentinelOne macOS Red Team](https://www.sentinelone.com/blog/macos-red-team-calling-apple-apis-without-building-binaries/)
- [SpecterOps JXA 2020](https://posts.specterops.io/persistent-jxa-66e1c3cd1cf5)
- [Red Canary Silver Sparrow Feb2021](https://redcanary.com/blog/clipping-silver-sparrows-wings/)
- [Atomic Red Team - T1059.007](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1059.007)
- [MITRE ATT&CK - T1059.007](https://attack.mitre.org/techniques/T1059/007)
