---
name: "T1090.001_internal-proxy"
description: "Adversaries may use an internal proxy to direct command and control traffic between two or more systems in a compromised environment."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1090.001
  - command-and-control
  - linux
  - network-devices
  - windows
  - macos
  - esxi
  - sub-technique
technique_id: "T1090.001"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Linux
  - Network Devices
  - Windows
  - macOS
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1090/001"
tech_stack:
  - linux
  - network devices
  - windows
  - macos
  - esxi
cwe_ids:
  - CWE-300
chains_with:
  - T1090
  - T1090.002
  - T1090.003
  - T1090.004
prerequisites:
  - T1090
severity_boost:
  T1090: "Chain with T1090 for deeper attack path"
  T1090.002: "Chain with T1090.002 for deeper attack path"
  T1090.003: "Chain with T1090.003 for deeper attack path"
---

# T1090.001 Internal Proxy

> **Sub-technique of:** T1090

## High-Level Description

Adversaries may use an internal proxy to direct command and control traffic between two or more systems in a compromised environment. Many tools exist that enable traffic redirection through proxies or port redirection, including HTRAN, ZXProxy, and ZXPortMap. Adversaries use internal proxies to manage command and control communications inside a compromised environment, to reduce the number of simultaneous outbound network connections, to provide resiliency in the face of connection loss, or to ride over existing trusted communications paths between infected systems to avoid suspicion. Internal proxy connections may use common peer-to-peer (p2p) networking protocols, such as SMB, to better blend in with the environment.

By using a compromised internal system as a proxy, adversaries may conceal the true destination of C2 traffic while reducing the need for numerous connections to external systems.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** Linux, Network Devices, Windows, macOS, ESXi

## What to Check

- [ ] Identify if Internal Proxy technique is applicable to target environment
- [ ] Check Linux systems for indicators of Internal Proxy
- [ ] Check Network Devices systems for indicators of Internal Proxy
- [ ] Check Windows systems for indicators of Internal Proxy
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Connection Proxy

Enable traffic redirection.

Note that this test may conflict with pre-existing system configuration.

**Supported Platforms:** linux, macos

```bash
export #{proxy_scheme}_proxy=#{proxy_server}:#{proxy_port}
curl #{test_url}
```

**Dependencies:**

- Squid must be installed and running

### Atomic Test 2: Connection Proxy for macOS UI

Enable traffic redirection on macOS UI (not terminal).
The test will modify and enable the "Web Proxy" and "Secure Web Proxy" settings in System Preferences => Network => Advanced => Proxies for the specified network interface.

Note that this test may conflict with pre-existing system configuration.

**Supported Platforms:** macos

```bash
networksetup -setwebproxy #{interface} #{proxy_server} #{proxy_port}
networksetup -setsecurewebproxy #{interface} #{proxy_server} #{proxy_port}
```

### Atomic Test 3: portproxy reg key

Adds a registry key to set up a proxy on the endpoint at HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\PortProxy\v4tov4
Upon execution there will be a new proxy entry in netsh
netsh interface portproxy show all

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
netsh interface portproxy add v4tov4 listenport=#{listenport} connectport=#{connectport} connectaddress=#{connectaddress}
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Internal Proxy by examining the target platforms (Linux, Network Devices, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1090.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level. Signatures are often for unique indicators within protocols and may be based on the specific C2 protocol used by a particular adversary or tool, and will likely be different across various malware families and versions. Adversaries will likely change tool C2 signatures over time or construct protocols in such a way as to avoid detection by common defensive tools.

## Detection

### Internal Proxy Behavior via Lateral Host-to-Host C2 Relay

## Risk Assessment

| Finding                             | Severity | Impact              |
| ----------------------------------- | -------- | ------------------- |
| Internal Proxy technique applicable | Medium   | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Trend Micro APT Attack Tools](http://blog.trendmicro.com/trendlabs-security-intelligence/in-depth-look-apt-attack-tools-of-the-trade/)
- [Atomic Red Team - T1090.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1090.001)
- [MITRE ATT&CK - T1090.001](https://attack.mitre.org/techniques/T1090/001)
