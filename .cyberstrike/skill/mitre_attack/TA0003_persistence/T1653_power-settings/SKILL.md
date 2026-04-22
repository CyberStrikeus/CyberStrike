---
name: "T1653_power-settings"
description: "Adversaries may impair a system's ability to hibernate, reboot, or shut down in order to extend access to infected machines."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1653
  - persistence
  - windows
  - linux
  - macos
  - network-devices
technique_id: "T1653"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Windows
  - Linux
  - macOS
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1653"
tech_stack:
  - windows
  - linux
  - macos
  - network devices
cwe_ids:
  - CWE-276
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1653 Power Settings

## High-Level Description

Adversaries may impair a system's ability to hibernate, reboot, or shut down in order to extend access to infected machines. When a computer enters a dormant state, some or all software and hardware may cease to operate which can disrupt malicious activity.

Adversaries may abuse system utilities and configuration settings to maintain access by preventing machines from entering a state, such as standby, that can terminate malicious activity.

For example, `powercfg` controls all configurable power system settings on a Windows system and can be abused to prevent an infected host from locking or shutting down. Adversaries may also extend system lock screen timeout settings. Other relevant settings, such as disk and hibernate timeout, can be similarly abused to keep the infected machine running even if no user is active.

Aware that some malware cannot survive system reboots, adversaries may entirely delete files used to invoke system shut down or reboot.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Windows, Linux, macOS, Network Devices

## What to Check

- [ ] Identify if Power Settings technique is applicable to target environment
- [ ] Check Windows systems for indicators of Power Settings
- [ ] Check Linux systems for indicators of Power Settings
- [ ] Check macOS systems for indicators of Power Settings
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Power Settings by examining the target platforms (Windows, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1653 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1047 Audit

Periodically inspect systems for abnormal and unexpected power settings that may indicate malicious activty.

## Detection

### Detection Strategy for Power Settings Abuse

## Risk Assessment

| Finding                             | Severity | Impact      |
| ----------------------------------- | -------- | ----------- |
| Power Settings technique applicable | Low      | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Sleep, shut down, hibernate](https://www.avg.com/en/signal/should-you-shut-down-sleep-or-hibernate-your-pc-or-mac-laptop)
- [CoinLoader: A Sophisticated Malware Loader Campaign](https://www.avira.com/en/blog/coinloader-a-sophisticated-malware-loader-campaign)
- [BATLOADER: The Evasive Downloader Malware](https://blogs.vmware.com/security/2022/11/batloader-the-evasive-downloader-malware.html)
- [Two New Monero Malware Attacks Target Windows and Android Users](https://securityintelligence.com/news/two-new-monero-malware-attacks-target-windows-and-android-users/)
- [Condi-Botnet-binaries](https://www.fortinet.com/blog/threat-research/condi-ddos-botnet-spreads-via-tp-links-cve-2023-1389)
- [systemdsleep Linux](https://man7.org/linux/man-pages/man5/systemd-sleep.conf.5.html)
- [Microsoft: Powercfg command-line options](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/powercfg-command-line-options?adlt=strict)
- [Atomic Red Team - T1653](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1653)
- [MITRE ATT&CK - T1653](https://attack.mitre.org/techniques/T1653)
