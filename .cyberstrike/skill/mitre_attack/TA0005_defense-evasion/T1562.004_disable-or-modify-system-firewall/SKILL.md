---
name: "T1562.004_disable-or-modify-system-firewall"
description: "Adversaries may disable or modify system firewalls in order to bypass controls limiting network usage."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1562.004
  - defense-evasion
  - esxi
  - linux
  - macos
  - network-devices
  - windows
  - sub-technique
technique_id: "T1562.004"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1562/004"
tech_stack:
  - esxi
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1562
  - T1562.001
  - T1562.002
  - T1562.003
  - T1562.006
  - T1562.007
  - T1562.008
  - T1562.009
  - T1562.010
  - T1562.011
  - T1562.012
  - T1562.013
prerequisites:
  - T1562
severity_boost:
  T1562: "Chain with T1562 for deeper attack path"
  T1562.001: "Chain with T1562.001 for deeper attack path"
  T1562.002: "Chain with T1562.002 for deeper attack path"
---

# T1562.004 Disable or Modify System Firewall

> **Sub-technique of:** T1562

## High-Level Description

Adversaries may disable or modify system firewalls in order to bypass controls limiting network usage. Changes could be disabling the entire mechanism as well as adding, deleting, or modifying particular rules. This can be done numerous ways depending on the operating system, including via command-line, editing Windows Registry keys, and Windows Control Panel.

Modifying or disabling a system firewall may enable adversary C2 communications, lateral movement, and/or data exfiltration that would otherwise not be allowed. For example, adversaries may add a new firewall rule for a well-known protocol (such as RDP) using a non-traditional and potentially less securitized port (i.e. Non-Standard Port).

Adversaries may also modify host networking settings that indirectly manipulate system firewalls, such as interface bandwidth or network connection request thresholds. Settings related to enabling abuse of various Remote Services may also indirectly modify firewall rules.

In ESXi, firewall rules may be modified directly via the esxcli command line interface (e.g., via `esxcli network firewall set`) or via the vCenter user interface.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Disable or Modify System Firewall technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Disable or Modify System Firewall
- [ ] Check Linux systems for indicators of Disable or Modify System Firewall
- [ ] Check macOS systems for indicators of Disable or Modify System Firewall
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Disable Microsoft Defender Firewall

Disables the Microsoft Defender Firewall for the current profile.
Caution if you access remotely the host where the test runs! Especially with the cleanup command which will re-enable firewall for the current profile...

**Supported Platforms:** windows

```cmd
netsh advfirewall set currentprofile state off
```

### Atomic Test 2: Disable Microsoft Defender Firewall via Registry

Disables the Microsoft Defender Firewall for the public profile via registry
Caution if you access remotely the host where the test runs! Especially with the cleanup command which will re-enable firewall for the current profile...

**Supported Platforms:** windows

```cmd
reg add "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\PublicProfile" /v "EnableFirewall" /t REG_DWORD /d 0 /f
```

### Atomic Test 3: Allow SMB and RDP on Microsoft Defender Firewall

Allow all SMB and RDP rules on the Microsoft Defender Firewall for all profiles.
Caution if you access remotely the host where the test runs! Especially with the cleanup command which will reset the firewall and risk disabling those services...

**Supported Platforms:** windows

```cmd
netsh advfirewall firewall set rule group="remote desktop" new enable=Yes
netsh advfirewall firewall set rule group="file and printer sharing" new enable=Yes
```

### Atomic Test 4: Opening ports for proxy - HARDRAIN

This test creates a listening interface on a victim device. This tactic was used by HARDRAIN for proxying.

reference: https://www.us-cert.gov/sites/default/files/publications/MAR-10135536-F.pdf

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
netsh advfirewall firewall add rule name="atomic testing" action=allow dir=in protocol=TCP localport=450
```

### Atomic Test 5: Open a local port through Windows Firewall to any profile

This test will attempt to open a local port defined by input arguments to any profile

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
netsh advfirewall firewall add rule name="Open Port to Any" dir=in protocol=tcp localport=#{local_port} action=allow profile=any
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Disable or Modify System Firewall by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1562.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1047 Audit
Routinely check account role permissions to ensure only expected users and roles have permission to modify system firewalls.

### M1018 User Account Management
Ensure proper user permissions are in place to prevent adversaries from disabling or modifying firewall settings.

### M1024 Restrict Registry Permissions
Ensure proper Registry permissions are in place to prevent adversaries from disabling or modifying firewall settings.

### M1022 Restrict File and Directory Permissions
Ensure proper process and file permissions are in place to prevent adversaries from disabling or modifying firewall settings.


## Detection

### Detection of Disabled or Modified System Firewalls across OS Platforms.


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Disable or Modify System Firewall technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Broadcom ESXi Firewall](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/7-0/add-allowed-ip-addresses-for-an-esxi-host-by-using-the-vmware-host-client.html)
- [Huntress BlackCat](https://www.huntress.com/blog/blackcat-ransomware-affiliate-ttps)
- [Trellix Rnasomhouse 2024](https://www.trellix.com/en-au/blogs/research/ransomhouse-am-see/)
- [change_rdp_port_conti](https://x.com/TheDFIRReport/status/1498657772254240768)
- [Atomic Red Team - T1562.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1562.004)
- [MITRE ATT&CK - T1562.004](https://attack.mitre.org/techniques/T1562/004)
