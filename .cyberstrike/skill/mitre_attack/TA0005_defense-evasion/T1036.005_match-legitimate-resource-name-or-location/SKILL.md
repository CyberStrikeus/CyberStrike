---
name: "T1036.005_match-legitimate-resource-name-or-location"
description: "Adversaries may match or approximate the name or location of legitimate files, Registry keys, or other resources when naming/placing them."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1036.005
  - defense-evasion
  - containers
  - esxi
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1036.005"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Containers
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1036/005"
tech_stack:
  - containers
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1036
  - T1036.001
  - T1036.002
  - T1036.003
  - T1036.004
  - T1036.006
  - T1036.007
  - T1036.008
  - T1036.009
  - T1036.010
  - T1036.011
  - T1036.012
prerequisites:
  - T1036
severity_boost:
  T1036: "Chain with T1036 for deeper attack path"
  T1036.001: "Chain with T1036.001 for deeper attack path"
  T1036.002: "Chain with T1036.002 for deeper attack path"
---

# T1036.005 Match Legitimate Resource Name or Location

> **Sub-technique of:** T1036

## High-Level Description

Adversaries may match or approximate the name or location of legitimate files, Registry keys, or other resources when naming/placing them. This is done for the sake of evading defenses and observation. 

This may be done by placing an executable in a commonly trusted directory (ex: under System32) or giving it the name of a legitimate, trusted program (ex: `svchost.exe`). Alternatively, a Windows Registry key may be given a close approximation to a key used by a legitimate program. In containerized environments, a threat actor may create a resource in a trusted namespace or one that matches the naming convention of a container pod or cluster.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Containers, ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Match Legitimate Resource Name or Location technique is applicable to target environment
- [ ] Check Containers systems for indicators of Match Legitimate Resource Name or Location
- [ ] Check ESXi systems for indicators of Match Legitimate Resource Name or Location
- [ ] Check Linux systems for indicators of Match Legitimate Resource Name or Location
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Execute a process from a directory masquerading as the current parent directory

Create and execute a process from a directory masquerading as the current parent directory (`...` instead of normal `..`)

**Supported Platforms:** macos, linux

```bash
mkdir $HOME/...
cp $(which sh) $HOME/...
$HOME/.../sh -c "echo #{test_message}"
```

### Atomic Test 2: Masquerade as a built-in system executable

Launch an executable that attempts to masquerade as a legitimate executable.

**Supported Platforms:** windows

```powershell
Add-Type -TypeDefinition @'
public class Test {
    public static void Main(string[] args) {
        System.Console.WriteLine("tweet, tweet");
    }
}
'@ -OutputAssembly "#{executable_filepath}"

Start-Process -FilePath "#{executable_filepath}"
```

### Atomic Test 3: Masquerading cmd.exe as VEDetector.exe

This test simulates an adversary renaming cmd.exe to VEDetector.exe to masquerade as a legitimate application.
The test copies cmd.exe, renames it to VEDetector.exe, adds a registry run key for persistence, and executes the renamed binary.
This technique may be used to evade detection by mimicking legitimate software names or locations.

**Expected Output:**
- A new process named VEDetector.exe appears in the process list, but its behavior matches cmd.exe.
- SIEM/EDR systems may detect this as suspicious process activity (e.g., Sysmon Event ID 1 for process creation, or Event ID 13 for registry modifications).
- Registry modification in HKLM:\Software\Microsoft\Windows\CurrentVersion\Run may trigger persistence alerts in XDR platforms.

**References:**
- [MITRE ATT&CK T1036.005](https://attack.mitre.org/techniques/T1036/005/)
- [Sysmon Process Creation](https://docs.microsoft.com/en-us/sysinternals/downloads/sysmon)

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
# Copy and rename cmd.exe to VEDetector.exe
Copy-Item -Path "#{source_file}" -Destination "#{ved_path}\VEDetector.exe" -Force

# Create registry run key for persistence
New-ItemProperty -Path "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "VEDetector" -Value "#{ved_path}\VEDetector.exe" -PropertyType String -Force

# Start the renamed process
Start-Process -FilePath "#{ved_path}\VEDetector.exe"

Start-Sleep -Seconds 5
```

**Dependencies:**
- The source cmd.exe file must exist on the system.


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Match Legitimate Resource Name or Location by examining the target platforms (Containers, ESXi, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1036.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1022 Restrict File and Directory Permissions
Use file system access controls to protect folders such as `C:\Windows\System32`.

### M1038 Execution Prevention
Use tools that restrict program execution via application control by attributes other than file name for common operating system utilities that are needed.

### M1045 Code Signing
Require signed binaries and images.


## Detection

### Detection Strategy for Masquerading via Legitimate Resource Name or Location


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Match Legitimate Resource Name or Location technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Twitter ItsReallyNick Masquerading Update](https://x.com/ItsReallyNick/status/1055321652777619457)
- [Docker Images](https://docs.docker.com/engine/reference/commandline/images/)
- [Elastic Masquerade Ball](https://www.elastic.co/blog/how-hunt-masquerade-ball)
- [Aquasec Kubernetes Backdoor 2023](https://www.aquasec.com/blog/leveraging-kubernetes-rbac-to-backdoor-clusters/)
- [Atomic Red Team - T1036.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1036.005)
- [MITRE ATT&CK - T1036.005](https://attack.mitre.org/techniques/T1036/005)
