---
name: "T1070.003_clear-command-history"
description: "In addition to clearing system logs, an adversary may clear the command history of a compromised account to conceal the actions undertaken during an intrusion."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1070.003
  - defense-evasion
  - esxi
  - linux
  - macos
  - network-devices
  - windows
  - sub-technique
technique_id: "T1070.003"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1070/003"
tech_stack:
  - esxi
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1070
  - T1070.001
  - T1070.002
  - T1070.004
  - T1070.005
  - T1070.006
  - T1070.007
  - T1070.008
  - T1070.009
  - T1070.010
prerequisites:
  - T1070
severity_boost:
  T1070: "Chain with T1070 for deeper attack path"
  T1070.001: "Chain with T1070.001 for deeper attack path"
  T1070.002: "Chain with T1070.002 for deeper attack path"
---

# T1070.003 Clear Command History

> **Sub-technique of:** T1070

## High-Level Description

In addition to clearing system logs, an adversary may clear the command history of a compromised account to conceal the actions undertaken during an intrusion. Various command interpreters keep track of the commands users type in their terminal so that users can retrace what they've done.

On Linux and macOS, these command histories can be accessed in a few different ways. While logged in, this command history is tracked in a file pointed to by the environment variable <code>HISTFILE</code>. When a user logs off a system, this information is flushed to a file in the user's home directory called <code>~/.bash_history</code>. The benefit of this is that it allows users to go back to commands they've used before in different sessions. Adversaries may delete their commands from these logs by manually clearing the history (<code>history -c</code>) or deleting the bash history file <code>rm ~/.bash_history</code>. 

Adversaries may also leverage a Network Device CLI on network devices to clear command history data (<code>clear logging</code> and/or <code>clear history</code>). On ESXi servers, command history may be manually removed from the `/var/log/shell.log` file.

On Windows hosts, PowerShell has two different command history providers: the built-in history and the command history managed by the <code>PSReadLine</code> module. The built-in history only tracks the commands used in the current session. This command history is not available to other sessions and is deleted when the session ends.

The <code>PSReadLine</code> command history tracks the commands used in all PowerShell sessions and writes them to a file (<code>$env:APPDATA\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt</code> by default). This history file is available to all sessions and contains all past history since the file is not deleted when the session ends.

Adversaries may run the PowerShell command <code>Clear-History</code> to flush the entire command history from a current PowerShell session. This, however, will not delete/flush the <code>ConsoleHost_history.txt</code> file. Adversaries may also delete the <code>ConsoleHost_history.txt</code> file or edit its contents to hide PowerShell commands they have run.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Clear Command History technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Clear Command History
- [ ] Check Linux systems for indicators of Clear Command History
- [ ] Check macOS systems for indicators of Clear Command History
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Clear Bash history (rm)

Clears bash history via rm

**Supported Platforms:** linux, macos

```bash
rm #{history_path}
```

### Atomic Test 2: Clear Bash history (echo)

Clears bash history via echo

**Supported Platforms:** linux

```bash
echo "" > #{history_path}
```

### Atomic Test 3: Clear Bash history (cat dev/null)

Clears bash history via cat /dev/null

**Supported Platforms:** linux, macos

```bash
cat /dev/null > #{history_path}
```

### Atomic Test 4: Clear Bash history (ln dev/null)

Clears bash history via a symlink to /dev/null

**Supported Platforms:** linux, macos

```bash
ln -sf /dev/null #{history_path}
```

### Atomic Test 5: Clear Bash history (truncate)

Clears bash history via truncate

**Supported Platforms:** linux

```bash
truncate -s0 #{history_path}
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Clear Command History by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1070.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1029 Remote Data Storage
Forward logging of historical data to remote data store and centralized logging solution to preserve historical command line log data.

### M1022 Restrict File and Directory Permissions
Preventing users from deleting or writing to certain files can stop adversaries from maliciously altering their <code>~/.bash_history</code> or <code>ConsoleHost_history.txt</code> files.

### M1039 Environment Variable Permissions
Making the environment variables associated with command history read only may ensure that the history is preserved.


## Detection

### Behavioral Detection of Command History Clearing


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Clear Command History technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Broadcom ESXi Shell Audit](https://knowledge.broadcom.com/external/article/321910/auditing-esxi-shell-logins-and-commands.html)
- [Sophos PowerShell command audit](https://community.sophos.com/products/intercept/early-access-program/f/live-discover-response-queries/121529/live-discover---powershell-command-audit)
- [Microsoft PowerShell Command History](https://docs.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_history?view=powershell-7)
- [US-CERT-TA18-106A](https://www.us-cert.gov/ncas/alerts/TA18-106A)
- [Sophos PowerShell Command History Forensics](https://community.sophos.com/sophos-labs/b/blog/posts/powershell-command-history-forensics)
- [Atomic Red Team - T1070.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1070.003)
- [MITRE ATT&CK - T1070.003](https://attack.mitre.org/techniques/T1070/003)
