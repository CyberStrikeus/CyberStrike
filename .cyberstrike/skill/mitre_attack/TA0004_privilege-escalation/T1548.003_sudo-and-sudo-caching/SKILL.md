---
name: "T1548.003_sudo-and-sudo-caching"
description: "Adversaries may perform sudo caching and/or use the sudoers file to elevate privileges."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1548.003
  - privilege-escalation
  - defense-evasion
  - linux
  - macos
  - sub-technique
technique_id: "T1548.003"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - defense-evasion
platforms:
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1548/003"
tech_stack:
  - linux
  - macos
cwe_ids:
  - CWE-269
chains_with:
  - T1548
  - T1548.001
  - T1548.002
  - T1548.004
  - T1548.005
  - T1548.006
prerequisites:
  - T1548
severity_boost:
  T1548: "Chain with T1548 for deeper attack path"
  T1548.001: "Chain with T1548.001 for deeper attack path"
  T1548.002: "Chain with T1548.002 for deeper attack path"
---

# T1548.003 Sudo and Sudo Caching

> **Sub-technique of:** T1548

## High-Level Description

Adversaries may perform sudo caching and/or use the sudoers file to elevate privileges. Adversaries may do this to execute commands as other users or spawn processes with higher privileges.

Within Linux and MacOS systems, sudo (sometimes referred to as "superuser do") allows users to perform commands from terminals with elevated privileges and to control who can perform these commands on the system. The <code>sudo</code> command "allows a system administrator to delegate authority to give certain users (or groups of users) the ability to run some (or all) commands as root or another user while providing an audit trail of the commands and their arguments." Since sudo was made for the system administrator, it has some useful configuration features such as a <code>timestamp_timeout</code>, which is the amount of time in minutes between instances of <code>sudo</code> before it will re-prompt for a password. This is because <code>sudo</code> has the ability to cache credentials for a period of time. Sudo creates (or touches) a file at <code>/var/db/sudo</code> with a timestamp of when sudo was last run to determine this timeout. Additionally, there is a <code>tty_tickets</code> variable that treats each new tty (terminal session) in isolation. This means that, for example, the sudo timeout of one tty will not affect another tty (you will have to type the password again).

The sudoers file, <code>/etc/sudoers</code>, describes which users can run which commands and from which terminals. This also describes which commands users can run as other users or groups. This provides the principle of least privilege such that users are running in their lowest possible permissions for most of the time and only elevate to other users or permissions as needed, typically by prompting for a password. However, the sudoers file can also specify when to not prompt users for passwords with a line like <code>user1 ALL=(ALL) NOPASSWD: ALL</code>. Elevated privileges are required to edit this file though.

Adversaries can also abuse poor configurations of these mechanisms to escalate privileges without needing the user's password. For example, <code>/var/db/sudo</code>'s timestamp can be monitored to see if it falls within the <code>timestamp_timeout</code> range. If it does, then malware can execute sudo commands without needing to supply the user's password. Additional, if <code>tty_tickets</code> is disabled, adversaries can do this from any tty for that user.

In the wild, malware has disabled <code>tty_tickets</code> to potentially make scripting easier by issuing <code>echo \'Defaults !tty_tickets\' >> /etc/sudoers</code>. In order for this change to be reflected, the malware also issued <code>killall Terminal</code>. As of macOS Sierra, the sudoers file has <code>tty_tickets</code> enabled by default.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Defense Evasion (TA0005)

**Platforms:** Linux, macOS

## What to Check

- [ ] Identify if Sudo and Sudo Caching technique is applicable to target environment
- [ ] Check Linux systems for indicators of Sudo and Sudo Caching
- [ ] Check macOS systems for indicators of Sudo and Sudo Caching
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Sudo usage

Common Sudo enumeration methods.

**Supported Platforms:** macos, linux
**Elevation Required:** Yes

```bash
sudo -l
sudo cat /etc/sudoers
sudo vim /etc/sudoers
```

### Atomic Test 2: Sudo usage (freebsd)

Common Sudo enumeration methods.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo -l
sudo cat /usr/local/etc/sudoers
sudo ee /usr/local/etc/sudoers
```

**Dependencies:**

- Check if sudo is installed.

### Atomic Test 3: Unlimited sudo cache timeout

Sets sudo caching timestamp_timeout to a value for unlimited. This is dangerous to modify without using 'visudo', do not do this on a production system.

**Supported Platforms:** macos, linux
**Elevation Required:** Yes

```bash
sudo sed -i 's/env_reset.*$/env_reset,timestamp_timeout=-1/' /etc/sudoers
sudo visudo -c -f /etc/sudoers
```

### Atomic Test 4: Unlimited sudo cache timeout (freebsd)

Sets sudo caching timestamp_timeout to a value for unlimited. This is dangerous to modify without using 'visudo', do not do this on a production system.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo sed -i 's/env_reset.*$/env_reset,timestamp_timeout=-1/' /usr/local/etc/sudoers
sudo visudo -c -f /usr/local/etc/sudoers
```

**Dependencies:**

- Check if sudo is installed.

### Atomic Test 5: Disable tty_tickets for sudo caching

Sets sudo caching tty_tickets value to disabled. This is dangerous to modify without using 'visudo', do not do this on a production system.

**Supported Platforms:** macos, linux
**Elevation Required:** Yes

```bash
sudo sh -c "echo Defaults "'!'"tty_tickets >> /etc/sudoers"
sudo visudo -c -f /etc/sudoers
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Sudo and Sudo Caching by examining the target platforms (Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1548.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1022 Restrict File and Directory Permissions

The sudoers file should be strictly edited such that passwords are always required and that users can't spawn risky processes as users with higher privilege.

### M1028 Operating System Configuration

Ensuring that the <code>tty_tickets</code> setting is enabled will prevent this leakage across tty sessions.

### M1026 Privileged Account Management

By requiring a password, even if an adversary can get terminal access, they must know the password to run anything in the sudoers file. Setting the <code>timestamp_timeout</code> to 0 will require the user to input their password every time <code>sudo</code> is executed.

## Detection

### Behavioral Detection Strategy for Abuse of Sudo and Sudo Caching

## Risk Assessment

| Finding                                    | Severity | Impact               |
| ------------------------------------------ | -------- | -------------------- |
| Sudo and Sudo Caching technique applicable | High     | Privilege Escalation |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-269 | Improper Privilege Management |

## References

- [sudo man page 2018](https://www.sudo.ws/)
- [OSX.Dok Malware](https://blog.malwarebytes.com/threat-analysis/2017/04/new-osx-dok-malware-intercepts-web-traffic/)
- [cybereason osx proton](https://www.cybereason.com/blog/labs-proton-b-what-this-mac-malware-actually-does)
- [Atomic Red Team - T1548.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1548.003)
- [MITRE ATT&CK - T1548.003](https://attack.mitre.org/techniques/T1548/003)
