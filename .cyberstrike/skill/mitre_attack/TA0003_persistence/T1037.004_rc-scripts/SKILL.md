---
name: "T1037.004_rc-scripts"
description: "Adversaries may establish persistence by modifying RC scripts, which are executed during a Unix-like system’s startup."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1037.004
  - persistence
  - privilege-escalation
  - macos
  - linux
  - network-devices
  - esxi
  - sub-technique
technique_id: "T1037.004"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - macOS
  - Linux
  - Network Devices
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1037/004"
tech_stack:
  - macos
  - linux
  - network devices
  - esxi
cwe_ids:
  - CWE-276
chains_with:
  - T1037
  - T1037.001
  - T1037.002
  - T1037.003
  - T1037.005
prerequisites:
  - T1037
severity_boost:
  T1037: "Chain with T1037 for deeper attack path"
  T1037.001: "Chain with T1037.001 for deeper attack path"
  T1037.002: "Chain with T1037.002 for deeper attack path"
---

# T1037.004 RC Scripts

> **Sub-technique of:** T1037

## High-Level Description

Adversaries may establish persistence by modifying RC scripts, which are executed during a Unix-like system’s startup. These files allow system administrators to map and start custom services at startup for different run levels. RC scripts require root privileges to modify.

Adversaries may establish persistence by adding a malicious binary path or shell commands to <code>rc.local</code>, <code>rc.common</code>, and other RC scripts specific to the Unix-like distribution. Upon reboot, the system executes the script's contents as root, resulting in persistence.

Adversary abuse of RC scripts is especially effective for lightweight Unix-like distributions using the root user as default, such as ESXi hypervisors, IoT, or embedded systems. As ESXi servers store most system files in memory and therefore discard changes on shutdown, leveraging `/etc/rc.local.d/local.sh` is one of the few mechanisms for enabling persistence across reboots.

Several Unix-like systems have moved to Systemd and deprecated the use of RC scripts. This is now a deprecated mechanism in macOS in favor of Launchd. This technique can be used on Mac OS X Panther v10.3 and earlier versions which still execute the RC scripts. To maintain backwards compatibility some systems, such as Ubuntu, will execute the RC scripts if they exist with the correct file permissions.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** macOS, Linux, Network Devices, ESXi

## What to Check

- [ ] Identify if RC Scripts technique is applicable to target environment
- [ ] Check macOS systems for indicators of RC Scripts
- [ ] Check Linux systems for indicators of RC Scripts
- [ ] Check Network Devices systems for indicators of RC Scripts
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: rc.common

Modify rc.common

[Reference](https://developer.apple.com/library/content/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/StartupItems.html)

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo echo osascript -e 'tell app "Finder" to display dialog "Hello World"' >> /etc/rc.common
```

### Atomic Test 2: rc.common

Modify rc.common

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
filename='/etc/rc.common';if [ ! -f $filename ];then sudo touch $filename;else sudo cp $filename /etc/rc.common.original;fi
printf '%s\n' '#!/bin/bash' | sudo tee /etc/rc.common
echo "python3 -c \"import os, base64;exec(base64.b64decode('aW1wb3J0IG9zCm9zLnBvcGVuKCdlY2hvIGF0b21pYyB0ZXN0IGZvciBtb2RpZnlpbmcgcmMuY29tbW9uID4gL3RtcC9UMTAzNy4wMDQucmMuY29tbW9uJykK'))\"" | sudo tee -a /etc/rc.common
printf '%s\n' 'exit 0' | sudo tee -a /etc/rc.common
sudo chmod +x /etc/rc.common
```

### Atomic Test 3: rc.local

Modify rc.local

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
filename='/etc/rc.local';if [ ! -f $filename ];then sudo touch $filename;else sudo cp $filename /etc/rc.local.original;fi
[ "$(uname)" = 'FreeBSD' ] && alias python3=python3.9 && printf '#\!/usr/local/bin/bash' | sudo tee /etc/rc.local || printf '#!/bin/bash' | sudo tee /etc/rc.local
echo "\npython3 -c \"import os, base64;exec(base64.b64decode('aW1wb3J0IG9zCm9zLnBvcGVuKCdlY2hvIGF0b21pYyB0ZXN0IGZvciBtb2RpZnlpbmcgcmMubG9jYWwgPiAvdG1wL1QxMDM3LjAwNC5yYy5sb2NhbCcpCgo='))\"" | sudo tee -a /etc/rc.local
printf 'exit 0' | sudo tee -a /etc/rc.local
sudo chmod +x /etc/rc.local
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to RC Scripts by examining the target platforms (macOS, Linux, Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1037.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1022 Restrict File and Directory Permissions
Limit privileges of user accounts so only authorized users can edit the `rc.common` file.


## Detection

### Detection Strategy for Boot or Logon Initialization Scripts: RC Scripts


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| RC Scripts technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Apple Developer Doco Archive Launchd](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
- [Startup Items](https://developer.apple.com/library/content/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/StartupItems.html)
- [Juniper Networks ESXi Backdoor 2022](https://blogs.juniper.net/en-us/threat-research/a-custom-python-backdoor-for-vmware-esxi-servers)
- [Ubuntu Manpage systemd rc](http://manpages.ubuntu.com/manpages/bionic/man8/systemd-rc-local-generator.8.html)
- [IranThreats Kittens Dec 2017](https://iranthreats.github.io/resources/attribution-flying-rocket-kitten/)
- [Methods of Mac Malware Persistence](https://www.virusbulletin.com/uploads/pdf/conference/vb2014/VB2014-Wardle.pdf)
- [intezer-kaiji-malware](https://www.intezer.com/blog/research/kaiji-new-chinese-linux-malware-turning-to-golang/)
- [Intezer HiddenWasp Map 2019](https://www.intezer.com/blog-hiddenwasp-malware-targeting-linux-systems/)
- [Atomic Red Team - T1037.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1037.004)
- [MITRE ATT&CK - T1037.004](https://attack.mitre.org/techniques/T1037/004)
