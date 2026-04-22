---
name: "T1091_replication-through-removable-media"
description: "Adversaries may move onto systems, possibly those on disconnected or air-gapped networks, by copying malware to removable media and taking advantage of Autorun features when the media is inserted i..."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1091
  - lateral-movement
  - initial-access
  - windows
technique_id: "T1091"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
  - initial-access
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1091"
tech_stack:
  - windows
cwe_ids:
  - CWE-284
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1091 Replication Through Removable Media

## High-Level Description

Adversaries may move onto systems, possibly those on disconnected or air-gapped networks, by copying malware to removable media and taking advantage of Autorun features when the media is inserted into a system and executes. In the case of Lateral Movement, this may occur through modification of executable files stored on removable media or by copying malware and renaming it to look like a legitimate file to trick users into executing it on a separate system. In the case of Initial Access, this may occur through manual manipulation of the media, modification of systems used to initially format the media, or modification to the media's firmware itself.

Mobile devices may also be used to infect PCs with malware if connected via USB. This infection may be achieved using devices (Android, iOS, etc.) and, in some instances, USB charging cables. For example, when a smartphone is connected to a system, it may appear to be mounted similar to a USB-connected disk drive. If malware that is compatible with the connected system is on the mobile device, the malware could infect the machine (especially if Autorun features are enabled).

## Kill Chain Phase

- Lateral Movement (TA0008)
- Initial Access (TA0001)

**Platforms:** Windows

## What to Check

- [ ] Identify if Replication Through Removable Media technique is applicable to target environment
- [ ] Check Windows systems for indicators of Replication Through Removable Media
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: USB Malware Spread Simulation

Simulates an adversary copying malware to all connected removable drives.

**Supported Platforms:** windows

```powershell
$RemovableDrives=@()
$RemovableDrives = Get-WmiObject -Class Win32_LogicalDisk -filter "drivetype=2" | select-object -expandproperty DeviceID
ForEach ($Drive in $RemovableDrives)
{
write-host "Removable Drive Found:" $Drive
New-Item -Path $Drive/T1091Test1.txt -ItemType "file" -Force -Value "T1091 Test 1 has created this file to simulate malware spread to removable drives."
}
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Replication Through Removable Media by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1091 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1042 Disable or Remove Feature or Program
Disable Autorun if it is unnecessary. Disallow or restrict removable media at an organizational policy level if it is not required for business operations.

### M1034 Limit Hardware Installation
Limit the use of USB devices and removable media within a network.

### M1040 Behavior Prevention on Endpoint
On Windows 10, enable Attack Surface Reduction (ASR) rules to block unsigned/untrusted executable files (such as .exe, .dll, or .scr) from running from USB removable drives.


## Detection

### Removable Media Execution Chain Detection via File and Process Activity


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Replication Through Removable Media technique applicable | High | Lateral Movement |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-284 | Improper Access Control |


## References

- [Windows Malware Infecting Android](https://www.computerworld.com/article/2486903/windows-malware-tries-to-infect-android-devices-connected-to-pcs.html)
- [iPhone Charging Cable Hack](https://techcrunch.com/2019/08/12/iphone-charging-cable-hack-computer-def-con/)
- [Exploiting Smartphone USB ](https://citeseerx.ist.psu.edu/viewdoc/download?doi=10.1.1.226.3427&rep=rep1&type=pdf)
- [Atomic Red Team - T1091](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1091)
- [MITRE ATT&CK - T1091](https://attack.mitre.org/techniques/T1091)
