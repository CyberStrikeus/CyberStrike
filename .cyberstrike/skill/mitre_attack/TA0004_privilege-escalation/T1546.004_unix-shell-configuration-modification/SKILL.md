---
name: "T1546.004_unix-shell-configuration-modification"
description: "Adversaries may establish persistence through executing malicious commands triggered by a user’s shell."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1546.004
  - privilege-escalation
  - persistence
  - linux
  - macos
  - sub-technique
technique_id: "T1546.004"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - persistence
platforms:
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1546/004"
tech_stack:
  - linux
  - macos
cwe_ids:
  - CWE-269
chains_with:
  - T1546
  - T1546.001
  - T1546.002
  - T1546.003
  - T1546.005
  - T1546.006
  - T1546.007
  - T1546.008
  - T1546.009
  - T1546.010
  - T1546.011
  - T1546.012
  - T1546.013
  - T1546.014
  - T1546.015
  - T1546.016
  - T1546.017
  - T1546.018
prerequisites:
  - T1546
severity_boost:
  T1546: "Chain with T1546 for deeper attack path"
  T1546.001: "Chain with T1546.001 for deeper attack path"
  T1546.002: "Chain with T1546.002 for deeper attack path"
---

# T1546.004 Unix Shell Configuration Modification

> **Sub-technique of:** T1546

## High-Level Description

Adversaries may establish persistence through executing malicious commands triggered by a user’s shell. User Unix Shells execute several configuration scripts at different points throughout the session based on events. For example, when a user opens a command-line interface or remotely logs in (such as via SSH) a login shell is initiated. The login shell executes scripts from the system (<code>/etc</code>) and the user’s home directory (<code>~/</code>) to configure the environment. All login shells on a system use /etc/profile when initiated. These configuration scripts run at the permission level of their directory and are often used to set environment variables, create aliases, and customize the user’s environment. When the shell exits or terminates, additional shell scripts are executed to ensure the shell exits appropriately.

Adversaries may attempt to establish persistence by inserting commands into scripts automatically executed by shells. Using bash as an example, the default shell for most GNU/Linux systems, adversaries may add commands that launch malicious binaries into the <code>/etc/profile</code> and <code>/etc/profile.d</code> files. These files typically require root permissions to modify and are executed each time any shell on a system launches. For user level permissions, adversaries can insert malicious commands into <code>~/.bash_profile</code>, <code>~/.bash_login</code>, or <code>~/.profile</code> which are sourced when a user opens a command-line interface or connects remotely. Since the system only executes the first existing file in the listed order, adversaries have used <code>~/.bash_profile</code> to ensure execution. Adversaries have also leveraged the <code>~/.bashrc</code> file which is additionally executed if the connection is established remotely or an additional interactive shell is opened, such as a new tab in the command-line interface. Some malware targets the termination of a program to trigger execution, adversaries can use the <code>~/.bash_logout</code> file to execute malicious commands at the end of a session.

For macOS, the functionality of this technique is similar but may leverage zsh, the default shell for macOS 10.15+. When the Terminal.app is opened, the application launches a zsh login shell and a zsh interactive shell. The login shell configures the system environment using <code>/etc/profile</code>, <code>/etc/zshenv</code>, <code>/etc/zprofile</code>, and <code>/etc/zlogin</code>. The login shell then configures the user environment with <code>~/.zprofile</code> and <code>~/.zlogin</code>. The interactive shell uses the <code>~/.zshrc</code> to configure the user environment. Upon exiting, <code>/etc/zlogout</code> and <code>~/.zlogout</code> are executed. For legacy programs, macOS executes <code>/etc/bashrc</code> on startup.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Persistence (TA0003)

**Platforms:** Linux, macOS

## What to Check

- [ ] Identify if Unix Shell Configuration Modification technique is applicable to target environment
- [ ] Check Linux systems for indicators of Unix Shell Configuration Modification
- [ ] Check macOS systems for indicators of Unix Shell Configuration Modification
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Add command to .bash_profile

Adds a command to the .bash_profile file of the current user

**Supported Platforms:** macos, linux

```bash
echo '#{command_to_add}' >> ~/.bash_profile
```

### Atomic Test 2: Add command to .bashrc

Adds a command to the .bashrc file of the current user

**Supported Platforms:** macos, linux

```bash
echo '#{command_to_add}' >> ~/.bashrc
```

### Atomic Test 3: Add command to .shrc

Adds a command to the .shrc file of the current user

**Supported Platforms:** linux

```bash
echo '#{command_to_add}' >> ~/.shrc
```

### Atomic Test 4: Append to the system shell profile

An adversary may wish to establish persistence by executing malicious commands from the systems /etc/profile every time "any" user logs in.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
echo '#{text_to_append}' >> /etc/profile
```

### Atomic Test 5: Append commands user shell profile

An adversary may wish to establish persistence by executing malicious commands from the users ~/.profile every time the "user" logs in.

**Supported Platforms:** linux

```bash
echo '#{text_to_append}' >> ~/.profile
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Unix Shell Configuration Modification by examining the target platforms (Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1546.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1022 Restrict File and Directory Permissions

Making these files immutable and only changeable by certain administrators will limit the ability for adversaries to easily create user level persistence.

## Detection

### Detect Shell Configuration Modification for Persistence via Event-Triggered Execution

## Risk Assessment

| Finding                                                    | Severity | Impact               |
| ---------------------------------------------------------- | -------- | -------------------- |
| Unix Shell Configuration Modification technique applicable | Low      | Privilege Escalation |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-269 | Improper Privilege Management |

## References

- [anomali-linux-rabbit](https://www.anomali.com/blog/pulling-linux-rabbit-rabbot-malware-out-of-a-hat)
- [anomali-rocke-tactics](https://www.anomali.com/blog/illicit-cryptomining-threat-actor-rocke-changes-tactics-now-more-difficult-to-detect)
- [Linux manual bash invocation](https://wiki.archlinux.org/index.php/Bash#Invocation)
- [ScriptingOSX zsh](https://scriptingosx.com/2019/06/moving-to-zsh-part-2-configuration-files/)
- [bencane blog bashrc](https://web.archive.org/web/20220316014323/http://bencane.com/2013/09/16/understanding-a-little-more-about-etcprofile-and-etcbashrc/)
- [macOS MS office sandbox escape](https://cedowens.medium.com/macos-ms-office-sandbox-brain-dump-4509b5fed49a)
- [Magento](https://blog.sucuri.net/2018/05/shell-logins-as-a-magento-reinfection-vector.html)
- [Tsunami](https://unit42.paloaltonetworks.com/unit42-new-iotlinux-malware-targets-dvrs-forms-botnet/)
- [PersistentJXA_leopitt](https://posts.specterops.io/persistent-jxa-66e1c3cd1cf5)
- [code_persistence_zsh](https://github.com/D00MFist/PersistentJXA/blob/master/BashProfilePersist.js)
- [ESF_filemonitor](https://objective-see.com/blog/blog_0x48.html)
- [intezer-kaiji-malware](https://www.intezer.com/blog/research/kaiji-new-chinese-linux-malware-turning-to-golang/)
- [Atomic Red Team - T1546.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1546.004)
- [MITRE ATT&CK - T1546.004](https://attack.mitre.org/techniques/T1546/004)
