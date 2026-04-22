---
name: "T1021.005_vnc"
description: "Adversaries may use Valid Accounts to remotely control machines using Virtual Network Computing (VNC)."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1021.005
  - lateral-movement
  - linux
  - windows
  - macos
  - sub-technique
technique_id: "T1021.005"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
platforms:
  - Linux
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1021/005"
tech_stack:
  - linux
  - windows
  - macos
cwe_ids:
  - CWE-284
chains_with:
  - T1021
  - T1021.001
  - T1021.002
  - T1021.003
  - T1021.004
  - T1021.006
  - T1021.007
  - T1021.008
prerequisites:
  - T1021
severity_boost:
  T1021: "Chain with T1021 for deeper attack path"
  T1021.001: "Chain with T1021.001 for deeper attack path"
  T1021.002: "Chain with T1021.002 for deeper attack path"
---

# T1021.005 VNC

> **Sub-technique of:** T1021

## High-Level Description

Adversaries may use Valid Accounts to remotely control machines using Virtual Network Computing (VNC). VNC is a platform-independent desktop sharing system that uses the RFB (“remote framebuffer”) protocol to enable users to remotely control another computer’s display by relaying the screen, mouse, and keyboard inputs over the network.

VNC differs from Remote Desktop Protocol as VNC is screen-sharing software rather than resource-sharing software. By default, VNC uses the system's authentication, but it can be configured to use credentials specific to VNC.

Adversaries may abuse VNC to perform malicious actions as the logged-on user such as opening documents, downloading files, and running arbitrary commands. An adversary could use VNC to remotely control and monitor a system to collect data and information to pivot to other systems within the network. Specific VNC libraries/implementations have also been susceptible to brute force attacks and memory usage exploitation.

## Kill Chain Phase

- Lateral Movement (TA0008)

**Platforms:** Linux, Windows, macOS

## What to Check

- [ ] Identify if VNC technique is applicable to target environment
- [ ] Check Linux systems for indicators of VNC
- [ ] Check Windows systems for indicators of VNC
- [ ] Check macOS systems for indicators of VNC
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Enable Apple Remote Desktop Agent

ARD leverages a blend of protocols, including VNC to send the screen and control buffers and SSH for secure file transfer.
Adversaries can abuse ARD to gain remote code execution and perform lateral movement.

References: https://www.mandiant.com/resources/blog/leveraging-apple-remote-desktop-for-good-and-evil

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart -activate -configure -allowAccessFor -allUsers -privs -all -quiet
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to VNC by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1021.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

Uninstall any VNC server software where not required.

### M1037 Filter Network Traffic

VNC defaults to TCP ports 5900 for the server, 5800 for browser access, and 5500 for a viewer in listening mode. Filtering or blocking these ports will inhibit VNC traffic utilizing default ports.

### M1047 Audit

Inventory workstations for unauthorized VNC server software.

### M1033 Limit Software Installation

Restrict software installation to user groups that require it. A VNC server must be manually installed by the user or adversary.

## Detection

### Behavioral Detection of Unauthorized VNC Remote Control Sessions

## Risk Assessment

| Finding                  | Severity | Impact           |
| ------------------------ | -------- | ---------------- |
| VNC technique applicable | High     | Lateral Movement |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [Attacking VNC Servers PentestLab](https://pentestlab.blog/2012/10/30/attacking-vnc-servers/)
- [MacOS VNC software for Remote Desktop](https://support.apple.com/guide/remote-desktop/set-up-a-computer-running-vnc-software-apdbed09830/mac)
- [Havana authentication bug](https://lists.openstack.org/pipermail/openstack/2013-December/004138.html)
- [macOS root VNC login without authentication](https://www.tenable.com/blog/detecting-macos-high-sierra-root-account-without-authentication)
- [Offensive Security VNC Authentication Check](https://www.offensive-security.com/metasploit-unleashed/vnc-authentication/)
- [Gnome Remote Desktop grd-settings](https://gitlab.gnome.org/GNOME/gnome-remote-desktop/-/blob/9aa9181e/src/grd-settings.c#L207)
- [Gnome Remote Desktop gschema](https://gitlab.gnome.org/GNOME/gnome-remote-desktop/-/blob/9aa9181e/src/org.gnome.desktop.remote-desktop.gschema.xml.in)
- [Apple Unified Log Analysis Remote Login and Screen Sharing](https://sarah-edwards-xzkc.squarespace.com/blog/2020/4/30/analysis-of-apple-unified-logs-quarantine-edition-entry-6-working-from-home-remote-logins)
- [VNC Vulnerabilities](https://www.bleepingcomputer.com/news/security/dozens-of-vnc-vulnerabilities-found-in-linux-windows-solutions/)
- [The Remote Framebuffer Protocol](https://datatracker.ietf.org/doc/html/rfc6143#section-7.2.2)
- [VNC Authentication](https://help.realvnc.com/hc/en-us/articles/360002250097-Setting-up-System-Authentication)
- [Hijacking VNC](https://int0x33.medium.com/day-70-hijacking-vnc-enum-brute-access-and-crack-d3d18a4601cc)
- [Atomic Red Team - T1021.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1021.005)
- [MITRE ATT&CK - T1021.005](https://attack.mitre.org/techniques/T1021/005)
