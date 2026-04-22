---
name: "T1490_inhibit-system-recovery"
description: "Adversaries may delete or remove built-in data and turn off services designed to aid in the recovery of a corrupted system to prevent recovery."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1490
  - impact
  - containers
  - esxi
  - iaas
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1490"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Containers
  - ESXi
  - IaaS
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1490"
tech_stack:
  - containers
  - esxi
  - cloud
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1490 Inhibit System Recovery

## High-Level Description

Adversaries may delete or remove built-in data and turn off services designed to aid in the recovery of a corrupted system to prevent recovery. This may deny access to available backups and recovery options.

Operating systems may contain features that can help fix corrupted systems, such as a backup catalog, volume shadow copies, and automatic repair features. Adversaries may disable or delete system recovery features to augment the effects of Data Destruction and Data Encrypted for Impact. Furthermore, adversaries may disable recovery notifications, then corrupt backups.

A number of native Windows utilities have been used by adversaries to disable or delete system recovery features:

- <code>vssadmin.exe</code> can be used to delete all volume shadow copies on a system - <code>vssadmin.exe delete shadows /all /quiet</code>
- Windows Management Instrumentation can be used to delete volume shadow copies - <code>wmic shadowcopy delete</code>
- <code>wbadmin.exe</code> can be used to delete the Windows Backup Catalog - <code>wbadmin.exe delete catalog -quiet</code>
- <code>bcdedit.exe</code> can be used to disable automatic Windows recovery features by modifying boot configuration data - <code>bcdedit.exe /set {default} bootstatuspolicy ignoreallfailures & bcdedit /set {default} recoveryenabled no</code>
- <code>REAgentC.exe</code> can be used to disable Windows Recovery Environment (WinRE) repair/recovery options of an infected system
- <code>diskshadow.exe</code> can be used to delete all volume shadow copies on a system - <code>diskshadow delete shadows all</code>

On network devices, adversaries may leverage Disk Wipe to delete backup firmware images and reformat the file system, then System Shutdown/Reboot to reload the device. Together this activity may leave network devices completely inoperable and inhibit recovery operations.

On ESXi servers, adversaries may delete or encrypt snapshots of virtual machines to support Data Encrypted for Impact, preventing them from being leveraged as backups (e.g., via ` vim-cmd vmsvc/snapshot.removeall`).

Adversaries may also delete “online” backups that are connected to their network – whether via network storage media or through folders that sync to cloud services. In cloud environments, adversaries may disable versioning and backup policies and delete snapshots, database backups, machine images, and prior versions of objects designed to be used in disaster recovery scenarios.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Containers, ESXi, IaaS, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Inhibit System Recovery technique is applicable to target environment
- [ ] Check Containers systems for indicators of Inhibit System Recovery
- [ ] Check ESXi systems for indicators of Inhibit System Recovery
- [ ] Check IaaS systems for indicators of Inhibit System Recovery
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Windows - Delete Volume Shadow Copies

Deletes Windows Volume Shadow Copies. This technique is used by numerous ransomware families and APT malware such as Olympic Destroyer. Upon
execution, if no shadow volumes exist the message "No items found that satisfy the query." will be displayed. If shadow volumes are present, it
will delete them without printing output to the screen. This is because the /quiet parameter was passed which also suppresses the y/n
confirmation prompt. Shadow copies can only be created on Windows server or Windows 8.

https://docs.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2012-R2-and-2012/cc788055(v=ws.11)

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
vssadmin.exe delete shadows /all /quiet
```

**Dependencies:**

- Create volume shadow copy of C:\ . This prereq command only works on Windows Server or Windows 8.

### Atomic Test 2: Windows - Delete Volume Shadow Copies via WMI

Deletes Windows Volume Shadow Copies via WMI. This technique is used by numerous ransomware families and APT malware such as Olympic Destroyer.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
wmic.exe shadowcopy delete
```

**Dependencies:**

- Create volume shadow copy of C:\ .

### Atomic Test 3: Windows - wbadmin Delete Windows Backup Catalog

Deletes Windows Backup Catalog. This technique is used by numerous ransomware families and APT malware such as Olympic Destroyer. Upon execution,
"The backup catalog has been successfully deleted." will be displayed in the PowerShell session.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
wbadmin delete catalog -quiet
```

### Atomic Test 4: Windows - Disable Windows Recovery Console Repair

Disables repair by the Windows Recovery Console on boot. This technique is used by numerous ransomware families and APT malware such as Olympic Destroyer.
Upon execution, "The operation completed successfully." will be displayed in the powershell session.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
bcdedit.exe /set {default} bootstatuspolicy ignoreallfailures
bcdedit.exe /set {default} recoveryenabled no
```

### Atomic Test 5: Windows - Delete Volume Shadow Copies via WMI with PowerShell

Deletes Windows Volume Shadow Copies with PowerShell code and Get-WMIObject.
This technique is used by numerous ransomware families such as Sodinokibi/REvil.
Executes Get-WMIObject. Shadow copies can only be created on Windows server or Windows 8, so upon execution
there may be no output displayed.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Get-WmiObject Win32_Shadowcopy | ForEach-Object {$_.Delete();}
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Inhibit System Recovery by examining the target platforms (Containers, ESXi, IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1490 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention

Consider using application control configured to block execution of utilities such as `diskshadow.exe` that may not be required for a given system or network to prevent potential misuse by adversaries.

### M1028 Operating System Configuration

Consider technical controls to prevent the disabling of services or deletion of files involved in system recovery. Additionally, ensure that WinRE is enabled using the following command: <code>reagentc /enable</code>.

### M1018 User Account Management

Limit the user accounts that have access to backups to only those required. In AWS environments, consider using Service Control Policies to restrict API calls to delete backups, snapshots, and images.

### M1053 Data Backup

Consider implementing IT disaster recovery plans that contain procedures for taking regular data backups that can be used to restore organizational data. Ensure backups are stored off system and is protected from common methods adversaries may use to gain access and destroy the backups to prevent recovery. In cloud environments, enable versioning on storage objects where possible, and copy backups to other accounts or regions to isolate them from the original copies. On ESXi servers, ensure that disk images and snapshots of virtual machines are regularly taken, with copies stored off system.

## Detection

### Behavioral Detection for T1490 - Inhibit System Recovery

## Risk Assessment

| Finding                                      | Severity | Impact |
| -------------------------------------------- | -------- | ------ |
| Inhibit System Recovery technique applicable | Low      | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [Dark Reading Code Spaces Cyber Attack](https://www.darkreading.com/attacks-breaches/code-hosting-service-shuts-down-after-cyber-attack)
- [FireEye WannaCry 2017](https://www.fireeye.com/blog/threat-research/2017/05/wannacry-malware-profile.html)
- [Cybereason](https://www.cybereason.com/blog/cybereason-vs.-blackcat-ransomware)
- [Talos Olympic Destroyer 2018](https://blog.talosintelligence.com/2018/02/olympic-destroyer.html)
- [Diskshadow](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/diskshadow)
- [Crytox Ransomware](https://www.zscaler.com/blogs/security-research/technical-analysis-crytox-ransomware)
- [Rhino Security Labs AWS S3 Ransomware](https://rhinosecuritylabs.com/aws/s3-ransomware-part-2-prevention-and-defense/)
- [ZDNet Ransomware Backups 2020](https://www.zdnet.com/article/ransomware-victims-thought-their-backups-were-safe-they-were-wrong/)
- [disable_notif_synology_ransom](https://x.com/TheDFIRReport/status/1498657590259109894)
- [Atomic Red Team - T1490](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1490)
- [MITRE ATT&CK - T1490](https://attack.mitre.org/techniques/T1490)
