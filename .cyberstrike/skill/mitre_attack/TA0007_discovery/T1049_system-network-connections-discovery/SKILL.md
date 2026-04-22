---
name: "T1049_system-network-connections-discovery"
description: "Adversaries may attempt to get a listing of network connections to or from the compromised system they are currently accessing or from remote systems by querying for information over the network."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1049
  - discovery
  - windows
  - iaas
  - linux
  - macos
  - network-devices
  - esxi
technique_id: "T1049"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Windows
  - IaaS
  - Linux
  - macOS
  - Network Devices
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1049"
tech_stack:
  - windows
  - cloud
  - linux
  - macos
  - network devices
  - esxi
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1049 System Network Connections Discovery

## High-Level Description

Adversaries may attempt to get a listing of network connections to or from the compromised system they are currently accessing or from remote systems by querying for information over the network. 

An adversary who gains access to a system that is part of a cloud-based environment may map out Virtual Private Clouds or Virtual Networks in order to determine what systems and services are connected. The actions performed are likely the same types of discovery techniques depending on the operating system, but the resulting information may include details about the networked cloud environment relevant to the adversary's goals. Cloud providers may have different ways in which their virtual networks operate. Similarly, adversaries who gain access to network devices may also perform similar discovery activities to gather information about connected systems and services.

Utilities and commands that acquire this information include netstat, "net use," and "net session" with Net. In Mac and Linux, netstat and <code>lsof</code> can be used to list current connections. <code>who -a</code> and <code>w</code> can be used to show which users are currently logged in, similar to "net session". Additionally, built-in features native to network devices and Network Device CLI may be used (e.g. <code>show ip sockets</code>, <code>show tcp brief</code>). On ESXi servers, the command `esxi network ip connection list` can be used to list active network connections.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Windows, IaaS, Linux, macOS, Network Devices, ESXi

## What to Check

- [ ] Identify if System Network Connections Discovery technique is applicable to target environment
- [ ] Check Windows systems for indicators of System Network Connections Discovery
- [ ] Check IaaS systems for indicators of System Network Connections Discovery
- [ ] Check Linux systems for indicators of System Network Connections Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: System Network Connections Discovery

Get a listing of network connections.

Upon successful execution, cmd.exe will execute `netstat`, `net use` and `net sessions`. `net sessions` requires
elevated privileges; on standard user accounts this command may not return results. Results will output via stdout.

**Supported Platforms:** windows

```cmd
netstat -ano
net use
net sessions 2>nul
```

### Atomic Test 2: System Network Connections Discovery with PowerShell

Get a listing of network connections.
Upon successful execution, powershell.exe will execute `get-NetTCPConnection`. Results will output via stdout.

**Supported Platforms:** windows

```powershell
Get-NetTCPConnection
```

### Atomic Test 3: System Network Connections Discovery via PowerShell (Process Mapping)

Enumerate TCP connections and map to owning process names via PowerShell.

**Supported Platforms:** windows

```powershell
Get-NetTCPConnection | ForEach-Object {
  $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  [pscustomobject]@{
    Local   = "$($_.LocalAddress):$($_.LocalPort)"
    Remote  = "$($_.RemoteAddress):$($_.RemotePort)"
    State   = $_.State
    PID     = $_.OwningProcess
    Process = if ($p) { $p.ProcessName } else { $null }
  }
} | Sort-Object State,Process | Format-Table -AutoSize
```

### Atomic Test 4: System Network Connections Discovery via ss or lsof (Linux/MacOS)

List active TCP/UDP network connections using ss, with lsof as a fallback
when ss is unavailable. Serves as an alternative to the netstat-based test.

**Supported Platforms:** linux, macos

```bash
if command -v ss >/dev/null 2>&1; then ss -antp 2>/dev/null || ss -ant; ss -aunp 2>/dev/null || true; else lsof -i -nP 2>/dev/null || true; fi
```

### Atomic Test 5: System Network Connections Discovery FreeBSD, Linux & MacOS

Get a listing of network connections.

Upon successful execution, sh will execute `netstat` and `who -a`. Results will output via stdout.

**Supported Platforms:** linux, macos

```bash
netstat
who -a
```

**Dependencies:**
- Check if netstat command exists on the machine


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to System Network Connections Discovery by examining the target platforms (Windows, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1049 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of System Network Connections Discovery Across Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| System Network Connections Discovery technique applicable | Medium | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Amazon AWS VPC Guide](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html)
- [Microsoft Azure Virtual Network Overview](https://docs.microsoft.com/en-us/azure/virtual-network/virtual-networks-overview)
- [Google VPC Overview](https://cloud.google.com/vpc/docs/vpc)
- [US-CERT-TA18-106A](https://www.us-cert.gov/ncas/alerts/TA18-106A)
- [Sygnia ESXi Ransomware 2025](https://www.sygnia.co/blog/esxi-ransomware-ssh-tunneling-defense-strategies/)
- [Atomic Red Team - T1049](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1049)
- [MITRE ATT&CK - T1049](https://attack.mitre.org/techniques/T1049)
