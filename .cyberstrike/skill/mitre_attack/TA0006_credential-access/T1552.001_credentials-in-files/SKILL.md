---
name: "T1552.001_credentials-in-files"
description: "Adversaries may search local file systems and remote file shares for files containing insecurely stored credentials."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1552.001
  - credential-access
  - containers
  - iaas
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1552.001"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Containers
  - IaaS
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1552/001"
tech_stack:
  - containers
  - cloud
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1552
  - T1552.002
  - T1552.003
  - T1552.004
  - T1552.005
  - T1552.006
  - T1552.007
  - T1552.008
prerequisites:
  - T1552
severity_boost:
  T1552: "Chain with T1552 for deeper attack path"
  T1552.002: "Chain with T1552.002 for deeper attack path"
  T1552.003: "Chain with T1552.003 for deeper attack path"
---

# T1552.001 Credentials In Files

> **Sub-technique of:** T1552

## High-Level Description

Adversaries may search local file systems and remote file shares for files containing insecurely stored credentials. These can be files created by users to store their own credentials, shared credential stores for a group of individuals, configuration files containing passwords for a system or service, or source code/binary files containing embedded passwords.

It is possible to extract passwords from backups or saved virtual machines through OS Credential Dumping. Passwords may also be obtained from Group Policy Preferences stored on the Windows Domain Controller.

In cloud and/or containerized environments, authenticated user and service account credentials are often stored in local configuration and credential files. They may also be found as parameters to deployment commands in container logs. In some cases, these files can be copied and reused on another machine or the contents can be read and then used to authenticate without needing to copy any files.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Containers, IaaS, Linux, macOS, Windows

## What to Check

- [ ] Identify if Credentials In Files technique is applicable to target environment
- [ ] Check Containers systems for indicators of Credentials In Files
- [ ] Check IaaS systems for indicators of Credentials In Files
- [ ] Check Linux systems for indicators of Credentials In Files
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Find AWS credentials

Find local AWS credentials from file, defaults to using / as the look path.

**Supported Platforms:** macos, linux

```bash
find #{file_path}/.aws -name "credentials" -type f 2>/dev/null
```

### Atomic Test 2: Extract Browser and System credentials with LaZagne

[LaZagne Source](https://github.com/AlessandroZ/LaZagne)

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
python2 laZagne.py all
```

### Atomic Test 3: Extract passwords with grep

Extracting credentials from files

**Supported Platforms:** linux, macos

```bash
grep -ri password #{file_path}
exit 0
```

### Atomic Test 4: Extracting passwords with findstr

Extracting Credentials from Files. Upon execution, the contents of files that contain the word "password" will be displayed.

**Supported Platforms:** windows

```powershell
findstr /si pass *.xml *.doc *.txt *.xls
ls -R | select-string -ErrorAction SilentlyContinue -Pattern password
```

### Atomic Test 5: Access unattend.xml

Attempts to access unattend.xml, where credentials are commonly stored, within the Panther directory where installation logs are stored.
If these files exist, their contents will be displayed. They are used to store credentials/answers during the unattended windows install process.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
type C:\Windows\Panther\unattend.xml
type C:\Windows\Panther\Unattend\unattend.xml
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Credentials In Files by examining the target platforms (Containers, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1552.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1017 User Training

Ensure that developers and system administrators are aware of the risk associated with having plaintext passwords in software configuration files that may be left on endpoint systems or servers.

### M1047 Audit

Preemptively search for files containing passwords and take actions to reduce the exposure risk when found.

### M1022 Restrict File and Directory Permissions

Restrict file shares to specific directories with access only to necessary users.

### M1027 Password Policies

Establish an organizational policy that prohibits password storage in files.

## Detection

### Detect Access to Unsecured Credential Files Across Platforms

## Risk Assessment

| Finding                                   | Severity | Impact            |
| ----------------------------------------- | -------- | ----------------- |
| Credentials In Files technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [CG 2014](http://carnal0wnage.attackresearch.com/2014/05/mimikatz-against-virtual-machine-memory.html)
- [Unit 42 Hildegard Malware](https://unit42.paloaltonetworks.com/hildegard-malware-teamtnt/)
- [Unit 42 Unsecured Docker Daemons](https://unit42.paloaltonetworks.com/attackers-tactics-and-techniques-in-unsecured-docker-daemons-revealed/)
- [Specter Ops - Cloud Credential Storage](https://posts.specterops.io/head-in-the-clouds-bd038bb69e48)
- [SRD GPP](http://blogs.technet.com/b/srd/archive/2014/05/13/ms14-025-an-update-for-group-policy-preferences.aspx)
- [Atomic Red Team - T1552.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1552.001)
- [MITRE ATT&CK - T1552.001](https://attack.mitre.org/techniques/T1552/001)
