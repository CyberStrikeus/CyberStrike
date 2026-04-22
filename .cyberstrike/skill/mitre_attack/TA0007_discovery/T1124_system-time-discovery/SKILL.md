---
name: "T1124_system-time-discovery"
description: "An adversary may gather the system time and/or time zone settings from a local or remote system."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1124
  - discovery
  - esxi
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1124"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1124"
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

# T1124 System Time Discovery

## High-Level Description

An adversary may gather the system time and/or time zone settings from a local or remote system. The system time is set and stored by services, such as the Windows Time Service on Windows or <code>systemsetup</code> on macOS. These time settings may also be synchronized between systems and services in an enterprise network, typically accomplished with a network time server within a domain.

System time information may be gathered in a number of ways, such as with Net on Windows by performing <code>net time \\hostname</code> to gather the system time on a remote system. The victim's time zone may also be inferred from the current system time or gathered by using <code>w32tm /tz</code>. In addition, adversaries can discover device uptime through functions such as <code>GetTickCount()</code> to determine how long it has been since the system booted up.

On network devices, Network Device CLI commands such as `show clock detail` can be used to see the current time configuration. On ESXi servers, `esxcli system clock get` can be used for the same purpose.

In addition, system calls – such as <code>time()</code> – have been used to collect the current time on Linux devices. On macOS systems, adversaries may use commands such as <code>systemsetup -gettimezone</code> or <code>timeIntervalSinceNow</code> to gather current time zone information or current date and time.

This information could be useful for performing other techniques, such as executing a file with a Scheduled Task/Job, or to discover locality information based on time zone to assist in victim targeting (i.e. System Location Discovery). Adversaries may also use knowledge of system time as part of a time bomb, or delaying execution until a specified date/time.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if System Time Discovery technique is applicable to target environment
- [ ] Check ESXi systems for indicators of System Time Discovery
- [ ] Check Linux systems for indicators of System Time Discovery
- [ ] Check macOS systems for indicators of System Time Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: System Time Discovery

Identify the system time. Upon execution, the local computer system time and timezone will be displayed.

**Supported Platforms:** windows

```cmd
net time \\#{computer_name}
w32tm /tz
```

### Atomic Test 2: System Time Discovery - PowerShell

Identify the system time via PowerShell. Upon execution, the system time will be displayed.

**Supported Platforms:** windows

```powershell
Get-Date
```

### Atomic Test 3: System Time Discovery in FreeBSD/macOS

Identify system time. Upon execution, the local computer system time and timezone will be displayed.

**Supported Platforms:** linux, macos

```bash
date
```

### Atomic Test 4: System Time Discovery W32tm as a Delay

identifies DCRat delay time tactics using w32tm.
https://research.splunk.com/endpoint/b2cc69e7-11ba-42dc-a269-59c069a48870/
https://blogs.blackberry.com/en/2022/05/dirty-deeds-done-dirt-cheap-russian-rat-offers-backdoor-bargains

**Supported Platforms:** windows

```cmd
W32tm /stripchart /computer:localhost /period:5 /dataonly /samples:2
```

### Atomic Test 5: System Time with Windows time Command

Displays the current system time via the Windows builtin time command: https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/time
Recently observed in use in the wild during an incident involving Ursnif malware:
https://github.com/The-DFIR-Report/Sigma-Rules/blob/dc72f0b557fc63347379be0a33439788256761c8/rules/windows/process_creation/proc_creation_win_system_time_lookup.yml
https://thedfirreport.com/2023/01/09/unwrapping-ursnifs-gifts/

**Supported Platforms:** windows

```cmd
time
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to System Time Discovery by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1124 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Behavior-chain, platform-aware detection strategy for T1124 System Time Discovery

## Risk Assessment

| Finding                                    | Severity | Impact    |
| ------------------------------------------ | -------- | --------- |
| System Time Discovery technique applicable | Medium   | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [systemsetup mac time](https://support.apple.com/en-gb/guide/remote-desktop/apd95406b8d/mac)
- [linux system time](https://wiki.archlinux.org/title/System_time)
- [MAGNET GOBLIN](https://research.checkpoint.com/2024/magnet-goblin-targets-publicly-facing-servers-using-1-day-vulnerabilities/)
- [show_clock_detail_cisco_cmd](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/security/s1/sec-s1-cr-book/sec-cr-s2.html#wp1896741674)
- [Mac Time Sync](https://www.macinstruct.com/tutorials/synchronize-your-macs-clock-with-a-time-server/)
- [ESET DazzleSpy Jan 2022](https://www.welivesecurity.com/2022/01/25/watering-hole-deploys-new-macos-malware-dazzlespy-asia/)
- [AnyRun TimeBomb](https://any.run/cybersecurity-blog/time-bombs-malware-with-delayed-execution/)
- [Technet Windows Time Service](https://technet.microsoft.com/windows-server-docs/identity/ad-ds/get-started/windows-time-service/windows-time-service-tools-and-settings)
- [MSDN System Time](https://msdn.microsoft.com/ms724961.aspx)
- [RSA EU12 They're Inside](https://www.rsaconference.com/writable/presentations/file_upload/ht-209_rivner_schwartz.pdf)
- [System Information Discovery Technique](https://www.picussecurity.com/resource/the-system-information-discovery-technique-explained-mitre-attack-t1082)
- [Virtualization/Sandbox Evasion](https://www.picussecurity.com/resource/virtualization/sandbox-evasion-how-attackers-avoid-malware-analysis)
- [Atomic Red Team - T1124](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1124)
- [MITRE ATT&CK - T1124](https://attack.mitre.org/techniques/T1124)
