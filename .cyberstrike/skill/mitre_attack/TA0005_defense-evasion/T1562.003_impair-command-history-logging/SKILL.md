---
name: "T1562.003_impair-command-history-logging"
description: "Adversaries may impair command history logging to hide commands they run on a compromised system."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1562.003
  - defense-evasion
  - esxi
  - linux
  - macos
  - network-devices
  - windows
  - sub-technique
technique_id: "T1562.003"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1562/003"
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
  - T1562.004
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

# T1562.003 Impair Command History Logging

> **Sub-technique of:** T1562

## High-Level Description

Adversaries may impair command history logging to hide commands they run on a compromised system. Various command interpreters keep track of the commands users type in their terminal so that users can retrace what they've done. 

On Linux and macOS, command history is tracked in a file pointed to by the environment variable <code>HISTFILE</code>. When a user logs off a system, this information is flushed to a file in the user's home directory called <code>~/.bash_history</code>. The <code>HISTCONTROL</code> environment variable keeps track of what should be saved by the <code>history</code> command and eventually into the <code>~/.bash_history</code> file when a user logs out. <code>HISTCONTROL</code> does not exist by default on macOS, but can be set by the user and will be respected. The `HISTFILE` environment variable is also used in some ESXi systems.

Adversaries may clear the history environment variable (<code>unset HISTFILE</code>) or set the command history size to zero (<code>export HISTFILESIZE=0</code>) to prevent logging of commands. Additionally, <code>HISTCONTROL</code> can be configured to ignore commands that start with a space by simply setting it to "ignorespace". <code>HISTCONTROL</code> can also be set to ignore duplicate commands by setting it to "ignoredups". In some Linux systems, this is set by default to "ignoreboth" which covers both of the previous examples. This means that “ ls” will not be saved, but “ls” would be saved by history. Adversaries can abuse this to operate without leaving traces by simply prepending a space to all of their terminal commands. 

On Windows systems, the <code>PSReadLine</code> module tracks commands used in all PowerShell sessions and writes them to a file (<code>$env:APPDATA\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt</code> by default). Adversaries may change where these logs are saved using <code>Set-PSReadLineOption -HistorySavePath {File Path}</code>. This will cause <code>ConsoleHost_history.txt</code> to stop receiving logs. Additionally, it is possible to turn off logging to this file using the PowerShell command <code>Set-PSReadlineOption -HistorySaveStyle SaveNothing</code>.

Adversaries may also leverage a Network Device CLI on network devices to disable historical command logging (e.g. <code>no logging</code>).

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Impair Command History Logging technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Impair Command History Logging
- [ ] Check Linux systems for indicators of Impair Command History Logging
- [ ] Check macOS systems for indicators of Impair Command History Logging
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Disable history collection

Disables history collection in shells

**Supported Platforms:** linux, macos

```bash
export HISTCONTROL=ignoreboth
#{evil_command}
```

### Atomic Test 2: Disable history collection (freebsd)

Disables history collection in shells

**Supported Platforms:** linux

```bash
export HISTSIZE=0
#{evil_command}
```

### Atomic Test 3: Mac HISTCONTROL

The HISTCONTROL variable is set to ignore (not write to the history file) command that are a duplicate of something already in the history 
and commands that start with a space. This atomic sets this variable in the current session and also writes it to the current user's ~/.bash_profile 
so that it will apply to all future settings as well.
https://www.linuxjournal.com/content/using-bash-history-more-efficiently-histcontrol

**Supported Platforms:** macos, linux

### Atomic Test 4: Clear bash history

An attacker may clear the bash history cache and the history file as their last act before logging off to remove the record of their command line activities. 

In this test we use the $HISTFILE variable throughout to 1. confirms the $HISTFILE variable is set 2. echo "" into it 3..5 confirm the file is empty 6 clear the history cache 7. confirm the history cache is empty. This is when the attacker would logoff.

**Supported Platforms:** linux

```bash
cp $HISTFILE $HISTFILE.OLD
if ((${#HISTFILE[@]})); then echo $HISTFILE; fi
echo "" > $HISTFILE
if [ $(wc -c <$HISTFILE) -gt 1 ]; then echo "$HISTFILE is larger than 1k"; fi
ls -la $HISTFILE 
cat $HISTFILE
history -c 
if [ $(history |wc -l) -eq 1 ]; then echo "History cache cleared"; fi
```

### Atomic Test 5: Setting the HISTCONTROL environment variable

An attacker may exploit the space before a command (e.g. " ls") or the duplicate command suppression feature in Bash history to prevent their commands from being recorded in the history file or to obscure the order of commands used. 

In this test we 1. sets $HISTCONTROL to ignoreboth 2. clears the history cache 3. executes ls -la with a space in-front of it 4. confirms that ls -la is not in the history cache 5. sets $HISTCONTROL to erasedups 6. clears the history cache 7..9 executes ls -la $HISTFILE 3 times 10. confirms that their is only one command in history

**Supported Platforms:** linux

```bash
TEST=$(echo $HISTCONTROL)
if [ "$HISTCONTROL" != "ignoreboth" ]; then export HISTCONTROL="ignoreboth"; fi
history -c 
ls -la $HISTFILE # " ls -la $HISTFILE"
if [ $(history |wc -l) -eq 1 ]; then echo "ls -la is not in history cache"; fi
if [ "$HISTCONTROL" != "erasedups" ]; then export HISTCONTROL="erasedups"; fi
history -c 
ls -la $HISTFILE
ls -la $HISTFILE
ls -la $HISTFILE
if [ $(history |wc -l) -eq 2 ]; then echo "Their is only one entry for ls -la $HISTFILE"; fi
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Impair Command History Logging by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1562.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1028 Operating System Configuration
Make sure that the <code>HISTCONTROL</code> environment variable is set to “ignoredups” instead of “ignoreboth” or “ignorespace”.

### M1039 Environment Variable Permissions
Prevent users from changing the <code>HISTCONTROL</code>, <code>HISTFILE</code>, and <code>HISTFILESIZE</code> environment variables.


## Detection

### Detection Strategy for Impair Defenses via Impair Command History Logging across OS platforms.


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Impair Command History Logging technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Google Cloud Threat Intelligence ESXi VIBs 2022](https://cloud.google.com/blog/topics/threat-intelligence/esxi-hypervisors-malware-persistence)
- [Sophos PowerShell command audit](https://community.sophos.com/products/intercept/early-access-program/f/live-discover-response-queries/121529/live-discover---powershell-command-audit)
- [Microsoft PowerShell Command History](https://docs.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_history?view=powershell-7)
- [Sophos PowerShell Command History Forensics](https://community.sophos.com/sophos-labs/b/blog/posts/powershell-command-history-forensics)
- [Atomic Red Team - T1562.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1562.003)
- [MITRE ATT&CK - T1562.003](https://attack.mitre.org/techniques/T1562/003)
