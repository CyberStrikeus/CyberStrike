---
name: "T1059.003_windows-command-shell"
description: "Adversaries may abuse the Windows command shell for execution."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1059.003
  - execution
  - windows
  - sub-technique
technique_id: "T1059.003"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1059/003"
tech_stack:
  - windows
cwe_ids:
  - CWE-94
chains_with:
  - T1059
  - T1059.001
  - T1059.002
  - T1059.004
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

# T1059.003 Windows Command Shell

> **Sub-technique of:** T1059

## High-Level Description

Adversaries may abuse the Windows command shell for execution. The Windows command shell (cmd) is the primary command prompt on Windows systems. The Windows command prompt can be used to control almost any aspect of a system, with various permission levels required for different subsets of commands. The command prompt can be invoked remotely via Remote Services such as SSH.

Batch files (ex: .bat or .cmd) also provide the shell with a list of sequential commands to run, as well as normal scripting operations such as conditionals and loops. Common uses of batch files include long or repetitive tasks, or the need to run the same set of commands on multiple systems.

Adversaries may leverage cmd to execute various commands and payloads. Common uses include cmd to execute a single command, or abusing cmd interactively with input and output forwarded over a command and control channel.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Windows

## What to Check

- [ ] Identify if Windows Command Shell technique is applicable to target environment
- [ ] Check Windows systems for indicators of Windows Command Shell
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Create and Execute Batch Script

Creates and executes a simple batch script. Upon execution, CMD will briefly launch to run the batch script then close again.

**Supported Platforms:** windows

```powershell
Start-Process "#{script_path}"
```

**Dependencies:**
- Batch file must exist on disk at specified location (#{script_path})

### Atomic Test 2: Writes text to a file and displays it.

Writes text to a file and display the results. This test is intended to emulate the dropping of a malicious file to disk.

**Supported Platforms:** windows

```cmd
echo "#{message}" > "#{file_contents_path}" & type "#{file_contents_path}"
```

### Atomic Test 3: Suspicious Execution via Windows Command Shell

Command line executed via suspicious invocation. Example is from the 2021 Threat Detection Report by Red Canary.

**Supported Platforms:** windows

```cmd
%LOCALAPPDATA:~-3,1%md /c echo #{input_message} > #{output_file} & type #{output_file}
```

### Atomic Test 4: Simulate BlackByte Ransomware Print Bombing

This test attempts to open a file a specified number of times in Wordpad, then prints the contents. 
It is designed to mimic BlackByte ransomware's print bombing technique, where tree.dll, which contains the ransom note, is opened in Wordpad 75 times and then printed. 
See https://redcanary.com/blog/blackbyte-ransomware/.

**Supported Platforms:** windows

```powershell
cmd /c "for /l %x in (1,1,#{max_to_print}) do start wordpad.exe /p #{file_to_print}" | out-null
```

**Dependencies:**
- File to print must exist on disk at specified location (#{file_to_print})

### Atomic Test 5: Command Prompt read contents from CMD file and execute

Simulate Raspberry Robin using the "standard-in" command prompt feature cmd `/R <` to read and execute a file via cmd.exe
See https://redcanary.com/blog/raspberry-robin/.

**Supported Platforms:** windows

```cmd
cmd /r cmd<"#{input_file}"
```

**Dependencies:**
- CMD file must exist on disk at specified location (#{input_file})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Windows Command Shell by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1059.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention
Use application control where appropriate.


## Detection

### Behavioral Detection of Windows Command Shell Execution


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Windows Command Shell technique applicable | Low | Execution |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-94 | Improper Control of Generation of Code |


## References

- [SSH in Windows](https://docs.microsoft.com/en-us/windows/terminal/tutorials/ssh)
- [Atomic Red Team - T1059.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1059.003)
- [MITRE ATT&CK - T1059.003](https://attack.mitre.org/techniques/T1059/003)
