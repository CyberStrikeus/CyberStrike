---
name: "T1137_office-application-startup"
description: "Adversaries may leverage Microsoft Office-based applications for persistence between startups."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1137
  - persistence
  - windows
  - office-suite
technique_id: "T1137"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Windows
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1137"
tech_stack:
  - windows
  - office
cwe_ids:
  - CWE-276
chains_with:
  - T1137.001
  - T1137.002
  - T1137.003
  - T1137.004
  - T1137.005
  - T1137.006
prerequisites:
  []
severity_boost:
  T1137.001: "Chain with T1137.001 for deeper attack path"
  T1137.002: "Chain with T1137.002 for deeper attack path"
  T1137.003: "Chain with T1137.003 for deeper attack path"
---

# T1137 Office Application Startup

## High-Level Description

Adversaries may leverage Microsoft Office-based applications for persistence between startups. Microsoft Office is a fairly common application suite on Windows-based operating systems within an enterprise network. There are multiple mechanisms that can be used with Office for persistence when an Office-based application is started; this can include the use of Office Template Macros and add-ins.

A variety of features have been discovered in Outlook that can be abused to obtain persistence, such as Outlook rules, forms, and Home Page. These persistence mechanisms can work within Outlook or be used through Office 365.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Windows, Office Suite

## What to Check

- [ ] Identify if Office Application Startup technique is applicable to target environment
- [ ] Check Windows systems for indicators of Office Application Startup
- [ ] Check Office Suite systems for indicators of Office Application Startup
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Office Application Startup - Outlook as a C2

As outlined in MDSEC's Blog post https://www.mdsec.co.uk/2020/11/a-fresh-outlook-on-mail-based-persistence/ 
it is possible to use Outlook Macro as a way to achieve persistance and execute arbitrary commands. This transform Outlook into a C2.
Too achieve this two things must happened on the syste
- The macro security registry value must be set to '1'
- A file called VbaProject.OTM must be created in the Outlook Folder.

**Supported Platforms:** windows

```cmd
reg add "HKEY_CURRENT_USER\Software\Microsoft\Office\16.0\Outlook\Security" /v Level /t REG_DWORD /d 1 /f
mkdir  %APPDATA%\Microsoft\Outlook\ >nul 2>&1
echo "Atomic Red Team TEST" > %APPDATA%\Microsoft\Outlook\VbaProject.OTM
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Office Application Startup by examining the target platforms (Windows, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1137 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1042 Disable or Remove Feature or Program
Follow Office macro security best practices suitable for your environment. Disable Office VBA macros from executing.

Disable Office add-ins. If they are required, follow best practices for securing them by requiring them to be signed and disabling user notification for allowing add-ins. For some add-ins types (WLL, VBA) additional mitigation is likely required as disabling add-ins in the Office Trust Center does not disable WLL nor does it prevent VBA code from executing.

### M1040 Behavior Prevention on Endpoint
On Windows 10, enable Attack Surface Reduction (ASR) rules to prevent Office applications from creating child processes and from writing potentially malicious executable content to disk.

### M1051 Update Software
For the Outlook methods, blocking macros may be ineffective as the Visual Basic engine used for these features is separate from the macro scripting engine. Microsoft has released patches to try to address each issue. Ensure KB3191938 which blocks Outlook Visual Basic and displays a malicious code warning, KB4011091 which disables custom forms by default, and KB4011162 which removes the legacy Home Page feature, are applied to systems.

### M1054 Software Configuration
For the Office Test method, create the Registry key used to execute it and set the permissions to "Read Control" to prevent easy access to the key without administrator permissions or requiring Privilege Escalation.


## Detection

### Detect Office Startup-Based Persistence via Macros, Forms, and Registry Hooks


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Office Application Startup technique applicable | Low | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Microsoft Detect Outlook Forms](https://docs.microsoft.com/en-us/office365/securitycompliance/detect-and-remediate-outlook-rules-forms-attack)
- [TechNet O365 Outlook Rules](https://blogs.technet.microsoft.com/office365security/defending-against-rules-and-forms-injection/)
- [CrowdStrike Outlook Forms](https://malware.news/t/using-outlook-forms-for-lateral-movement-and-persistence/13746)
- [SensePost Ruler GitHub](https://github.com/sensepost/ruler)
- [SensePost NotRuler](https://github.com/sensepost/notruler)
- [Outlook Today Home Page](https://medium.com/@bwtech789/outlook-today-homepage-persistence-33ea9b505943)
- [Atomic Red Team - T1137](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1137)
- [MITRE ATT&CK - T1137](https://attack.mitre.org/techniques/T1137)
