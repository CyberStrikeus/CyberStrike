---
name: "T1485_data-destruction"
description: "Adversaries may destroy data and files on specific systems or in large numbers on a network to interrupt availability to systems, services, and network resources."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1485
  - impact
  - containers
  - esxi
  - iaas
  - linux
  - macos
  - windows
technique_id: "T1485"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Containers
  - ESXi
  - IaaS
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1485"
tech_stack:
  - containers
  - esxi
  - cloud
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-400
chains_with:
  - T1485.001
prerequisites:
  []
severity_boost:
  T1485.001: "Chain with T1485.001 for deeper attack path"
---

# T1485 Data Destruction

## High-Level Description

Adversaries may destroy data and files on specific systems or in large numbers on a network to interrupt availability to systems, services, and network resources. Data destruction is likely to render stored data irrecoverable by forensic techniques through overwriting files or data on local and remote drives. Common operating system file deletion commands such as <code>del</code> and <code>rm</code> often only remove pointers to files without wiping the contents of the files themselves, making the files recoverable by proper forensic methodology. This behavior is distinct from Disk Content Wipe and Disk Structure Wipe because individual files are destroyed rather than sections of a storage disk or the disk's logical structure.

Adversaries may attempt to overwrite files and directories with randomly generated data to make it irrecoverable. In some cases politically oriented image files have been used to overwrite data.

To maximize impact on the target organization in operations where network-wide availability interruption is the goal, malware designed for destroying data may have worm-like features to propagate across a network by leveraging additional techniques like Valid Accounts, OS Credential Dumping, and SMB/Windows Admin Shares..

In cloud environments, adversaries may leverage access to delete cloud storage objects, machine images, database instances, and other infrastructure crucial to operations to damage an organization or their customers. Similarly, they may delete virtual machines from on-prem virtualized environments.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Containers, ESXi, IaaS, Linux, macOS, Windows

## What to Check

- [ ] Identify if Data Destruction technique is applicable to target environment
- [ ] Check Containers systems for indicators of Data Destruction
- [ ] Check ESXi systems for indicators of Data Destruction
- [ ] Check IaaS systems for indicators of Data Destruction
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Windows - Overwrite file with SysInternals SDelete

Overwrites and deletes a file using SysInternals SDelete. Upon successful execution, "Files deleted: 1" will be displayed in
the powershell session along with other information about the file that was deleted.

**Supported Platforms:** windows

```powershell
if (-not (Test-Path "#{file_to_delete}")) { New-Item "#{file_to_delete}" -Force }
& "#{sdelete_exe}" -accepteula "#{file_to_delete}"
```

**Dependencies:**
- Secure delete tool from SysInternals must exist on disk at specified location (#{sdelete_exe})

### Atomic Test 2: FreeBSD/macOS/Linux - Overwrite file with DD

Overwrites and deletes a file using DD.
To stop the test, break the command with CTRL/CMD+C.

**Supported Platforms:** linux, macos

```bash
dd of=#{file_to_overwrite} if=#{overwrite_source} count=$(ls -l #{file_to_overwrite} | awk '{print $5}') iflag=count_bytes
```

### Atomic Test 3: Overwrite deleted data on C drive

RansomEXX malware removes all deleted files using windows built-in cipher.exe to prevent forensic recover.
This process is very slow and test execution may timeout. 
https://www.cybereason.com/blog/cybereason-vs.-ransomexx-ransomware
https://support.microsoft.com/en-us/topic/cipher-exe-security-tool-for-the-encrypting-file-system-56c85edd-85cf-ac07-f2f7-ca2d35dab7e4

**Supported Platforms:** windows

```cmd
cipher.exe /w:C:
```

### Atomic Test 5: ESXi - Delete VM Snapshots

Deletes all snapshots for all Virtual Machines on an ESXi Host
[Reference](https://lolesxi-project.github.io/LOLESXi/lolesxi/Binaries/vim-cmd/#inhibit%20recovery)

**Supported Platforms:** windows

```cmd
echo "" | "#{plink_file}" -batch "#{vm_host}" -ssh -l #{vm_user} -pw "#{vm_pass}" "for i in `vim-cmd vmsvc/getallvms | awk 'NR>1 {print $1}'`; do vim-cmd vmsvc/snapshot.removeall $i & done"
```

**Dependencies:**
- Check if we have plink


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Data Destruction by examining the target platforms (Containers, ESXi, IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1485 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1032 Multi-factor Authentication
Implement multi-factor authentication (MFA) delete for cloud storage resources, such as AWS S3 buckets, to prevent unauthorized deletion of critical data and infrastructure. MFA delete requires additional authentication steps, making it significantly more difficult for adversaries to destroy data without proper credentials. This additional security layer helps protect against the impact of data destruction in cloud environments by ensuring that only authenticated actions can irreversibly delete storage or machine images.

### M1053 Data Backup
Consider implementing IT disaster recovery plans that contain procedures for taking regular data backups that can be used to restore organizational data. Ensure backups are stored off system and protected from common methods adversaries may use to gain access and destroy the backups to prevent recovery.

### M1018 User Account Management
In cloud environments, limit permissions to modify cloud bucket lifecycle policies (e.g., `PutLifecycleConfiguration` in AWS) to only those accounts that require it. In AWS environments, consider using Service Control policies to limit the use of the `PutBucketLifecycle` API call.


## Detection

### Detection of Data Destruction Across Platforms via Mass Overwrite and Deletion Patterns


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Data Destruction technique applicable | High | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [DOJ  - Cisco Insider](https://www.justice.gov/usao-ndca/pr/san-jose-man-pleads-guilty-damaging-cisco-s-network)
- [Unit 42 Shamoon3 2018](https://unit42.paloaltonetworks.com/shamoon-3-targets-oil-gas-organization/)
- [Palo Alto Shamoon Nov 2016](http://researchcenter.paloaltonetworks.com/2016/11/unit42-shamoon-2-return-disttrack-wiper/)
- [FireEye Shamoon Nov 2016](https://web.archive.org/web/20210126065851/https://www.fireeye.com/blog/threat-research/2016/11/fireeye_respondsto.html)
- [Kaspersky StoneDrill 2017](https://media.kasperskycontenthub.com/wp-content/uploads/sites/43/2018/03/07180722/Report_Shamoon_StoneDrill_final.pdf)
- [Talos Olympic Destroyer 2018](https://blog.talosintelligence.com/2018/02/olympic-destroyer.html)
- [Data Destruction - Threat Post](https://threatpost.com/hacker-puts-hosting-service-code-spaces-out-of-business/106761/)
- [Symantec Shamoon 2012](https://www.symantec.com/connect/blogs/shamoon-attacks)
- [Atomic Red Team - T1485](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1485)
- [MITRE ATT&CK - T1485](https://attack.mitre.org/techniques/T1485)
