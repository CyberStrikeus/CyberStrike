---
name: "T1547.015_login-items"
description: "Adversaries may add login items to execute upon user login to gain persistence or escalate privileges."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1547.015
  - persistence
  - privilege-escalation
  - macos
  - sub-technique
technique_id: "T1547.015"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1547/015"
tech_stack:
  - macos
cwe_ids:
  - CWE-276
chains_with:
  - T1547
  - T1547.001
  - T1547.002
  - T1547.003
  - T1547.004
  - T1547.005
  - T1547.006
  - T1547.007
  - T1547.008
  - T1547.009
  - T1547.010
  - T1547.012
  - T1547.013
  - T1547.014
prerequisites:
  - T1547
severity_boost:
  T1547: "Chain with T1547 for deeper attack path"
  T1547.001: "Chain with T1547.001 for deeper attack path"
  T1547.002: "Chain with T1547.002 for deeper attack path"
---

# T1547.015 Login Items

> **Sub-technique of:** T1547

## High-Level Description

Adversaries may add login items to execute upon user login to gain persistence or escalate privileges. Login items are applications, documents, folders, or server connections that are automatically launched when a user logs in. Login items can be added via a shared file list or Service Management Framework. Shared file list login items can be set using scripting languages such as AppleScript, whereas the Service Management Framework uses the API call <code>SMLoginItemSetEnabled</code>.

Login items installed using the Service Management Framework leverage <code>launchd</code>, are not visible in the System Preferences, and can only be removed by the application that created them. Login items created using a shared file list are visible in System Preferences, can hide the application when it launches, and are executed through LaunchServices, not launchd, to open applications, documents, or URLs without using Finder. Users and applications use login items to configure their user environment to launch commonly used services or applications, such as email, chat, and music applications.

Adversaries can utilize AppleScript and Native API calls to create a login item to spawn malicious executables. Prior to version 10.5 on macOS, adversaries can add login items by using AppleScript to send an Apple events to the “System Events” process, which has an AppleScript dictionary for manipulating login items. Adversaries can use a command such as <code>tell application “System Events” to make login item at end with properties /path/to/executable</code>. This command adds the path of the malicious executable to the login item file list located in <code>~/Library/Application Support/com.apple.backgroundtaskmanagementagent/backgrounditems.btm</code>. Adversaries can also use login items to launch executables that can be used to control the victim system remotely or as a means to gain privilege escalation by prompting for user credentials.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** macOS

## What to Check

- [ ] Identify if Login Items technique is applicable to target environment
- [ ] Check macOS systems for indicators of Login Items
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 2: Add macOS LoginItem using Applescript

Runs osascript on a file to create new LoginItem for current user.
NOTE: Will popup dialog prompting user to Allow or Deny Terminal.app to control "System Events"
Therefore, it can't be automated until the TCC is granted.
The login item launches Safari.app when user logs in, but there is a cleanup script to remove it as well.
In addition to the `osascript` Process Events, file modification events to
`/Users/*/Library/Application Support/com.apple.backgroundtaskmanagementagent/backgrounditems.btm` should be seen.

**Supported Platforms:** macos

```bash
osascript #{scriptfile}
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Login Items by examining the target platforms (macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1547.015 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for T1547.015 – Login Items on macOS

## Risk Assessment

| Finding                          | Severity | Impact      |
| -------------------------------- | -------- | ----------- |
| Login Items technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Adding Login Items](https://developer.apple.com/library/content/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLoginItems.html)
- [Launch Service Keys Developer Apple](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/LaunchServicesKeys.html#//apple_ref/doc/uid/TP40009250-SW1)
- [Launch Services Apple Developer](https://developer.apple.com/documentation/coreservices/launch_services)
- [Login Items AE](https://developer.apple.com/library/archive/samplecode/LoginItemsAE/Introduction/Intro.html#//apple_ref/doc/uid/DTS10003788)
- [Open Login Items Apple](https://support.apple.com/guide/mac-help/open-items-automatically-when-you-log-in-mh15189/mac)
- [hexed osx.dok analysis 2019](https://web.archive.org/web/20221007144948/http://www.hexed.in/2019/07/osxdok-analysis.html)
- [ELC Running at startup](https://eclecticlight.co/2018/05/22/running-at-startup-when-to-use-a-login-item-or-a-launchagent-launchdaemon/)
- [Startup Items Eclectic](https://eclecticlight.co/2021/09/16/how-to-run-an-app-or-tool-at-startup/)
- [Add List Remove Login Items Apple Script](https://gist.github.com/kaloprominat/6111584)
- [CheckPoint Dok](https://blog.checkpoint.com/2017/04/27/osx-malware-catching-wants-read-https-traffic/)
- [objsee block blocking login items](https://objective-see.com/blog/blog_0x31.html)
- [objsee netwire backdoor 2019](https://objective-see.com/blog/blog_0x44.html)
- [objsee mac malware 2017](https://objective-see.com/blog/blog_0x25.html)
- [sentinelone macos persist Jun 2019](https://www.sentinelone.com/blog/how-malware-persists-on-macos/)
- [SMLoginItemSetEnabled Schroeder 2013](https://web.archive.org/web/20160216034946/https://blog.timschroeder.net/2013/04/21/smloginitemsetenabled-demystified/)
- [Atomic Red Team - T1547.015](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1547.015)
- [MITRE ATT&CK - T1547.015](https://attack.mitre.org/techniques/T1547/015)
