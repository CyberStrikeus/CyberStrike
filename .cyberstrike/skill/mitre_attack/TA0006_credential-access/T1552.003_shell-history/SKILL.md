---
name: "T1552.003_shell-history"
description: "Adversaries may search the command history on compromised systems for insecurely stored credentials."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1552.003
  - credential-access
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1552.003"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1552/003"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1552
  - T1552.001
  - T1552.002
  - T1552.004
  - T1552.005
  - T1552.006
  - T1552.007
  - T1552.008
prerequisites:
  - T1552
severity_boost:
  T1552: "Chain with T1552 for deeper attack path"
  T1552.001: "Chain with T1552.001 for deeper attack path"
  T1552.002: "Chain with T1552.002 for deeper attack path"
---

# T1552.003 Shell History

> **Sub-technique of:** T1552

## High-Level Description

Adversaries may search the command history on compromised systems for insecurely stored credentials.

On Linux and macOS systems, shells such as Bash and Zsh keep track of the commands users type on the command-line with the "history" utility. Once a user logs out, the history is flushed to the user's history file. For each user, this file resides at the same location: for example, `~/.bash_history` or `~/.zsh_history`. Typically, these files keeps track of the user's last 1000 commands.

On Windows, PowerShell has both a command history that is wiped after the session ends, and one that contains commands used in all sessions and is persistent. The default location for persistent history can be found in `%userprofile%\AppData\Roaming\Microsoft\Windows\PowerShell\PSReadline\ConsoleHost_history.txt`, but command history can also be accessed with `Get-History`. Command Prompt (CMD) on Windows does not have persistent history.

Users often type usernames and passwords on the command-line as parameters to programs, which then get saved to this file when they log out. Adversaries can abuse this by looking through the file for potential credentials.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Shell History technique is applicable to target environment
- [ ] Check Linux systems for indicators of Shell History
- [ ] Check macOS systems for indicators of Shell History
- [ ] Check Windows systems for indicators of Shell History
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Search Through Bash History

Search through bash history for specifice commands we want to capture

**Supported Platforms:** linux, macos

```bash
cat #{bash_history_filename} | grep #{bash_history_grep_args} > #{output_file}
```

### Atomic Test 2: Search Through sh History

Search through sh history for specifice commands we want to capture

**Supported Platforms:** linux

```bash
cat #{sh_history_filename} | grep #{sh_history_grep_args} > #{output_file}
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Shell History by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1552.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1028 Operating System Configuration

There are multiple methods of preventing a user's command history from being flushed to their .bash_history file, including use of the following commands:
<code>set +o history</code> and <code>set -o history</code> to start logging again;
<code>unset HISTFILE</code> being added to a user's .bash_rc file; and
<code>ln -s /dev/null ~/.bash_history</code> to write commands to <code>/dev/null</code> instead.

In Zsh, `fc -p` can be used to create a private history session. However, previous history will be unavailable to the user until the session ends. Using `unset HISTFILE` and writing commands to `/dev/null` can also be used, similarly to Bash.

In PowerShell, users can utilize `Set-PSReadLineOption` to modify how commands are saved into history. Setting `-HistorySaveStyle SaveNothing` prevents command history from being saved onto the file. Note that setting it from `SaveNothing` to `SaveIncrementally` in the same session will cause all commands from that session to be saved. Alternatively, `-AddToHistoryHandler` can be used to filter certain commands from being saved into the history file.

## Detection

### Detect Access and Parsing of .bash_history Files for Credential Harvesting

## Risk Assessment

| Finding                            | Severity | Impact            |
| ---------------------------------- | -------- | ----------------- |
| Shell History technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [External to DA, the OS X Way](https://www.slideshare.net/slideshow/external-to-da-the-os-x-way/62021418)
- [Medium](https://michaelkoczwara.medium.com/windows-privilege-escalation-dbb908cce8d4)
- [Microsoft about_History](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_history?view=powershell-7.5)
- [Atomic Red Team - T1552.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1552.003)
- [MITRE ATT&CK - T1552.003](https://attack.mitre.org/techniques/T1552/003)
