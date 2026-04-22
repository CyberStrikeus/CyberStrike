---
name: "T1071.001_web-protocols"
description: "Adversaries may communicate using application layer protocols associated with web traffic to avoid detection/network filtering by blending in with existing traffic."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1071.001
  - command-and-control
  - esxi
  - linux
  - macos
  - network-devices
  - windows
  - sub-technique
technique_id: "T1071.001"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1071/001"
tech_stack:
  - esxi
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-300
chains_with:
  - T1071
  - T1071.002
  - T1071.003
  - T1071.004
  - T1071.005
prerequisites:
  - T1071
severity_boost:
  T1071: "Chain with T1071 for deeper attack path"
  T1071.002: "Chain with T1071.002 for deeper attack path"
  T1071.003: "Chain with T1071.003 for deeper attack path"
---

# T1071.001 Web Protocols

> **Sub-technique of:** T1071

## High-Level Description

Adversaries may communicate using application layer protocols associated with web traffic to avoid detection/network filtering by blending in with existing traffic. Commands to the remote system, and often the results of those commands, will be embedded within the protocol traffic between the client and server.

Protocols such as HTTP/S and WebSocket that carry web traffic may be very common in environments. HTTP/S packets have many fields and headers in which data can be concealed. An adversary may abuse these protocols to communicate with systems under their control within a victim network while also mimicking normal, expected traffic.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Web Protocols technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Web Protocols
- [ ] Check Linux systems for indicators of Web Protocols
- [ ] Check macOS systems for indicators of Web Protocols
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Malicious User Agents - Powershell

This test simulates an infected host beaconing to command and control. Upon execution, no output will be displayed.
Use an application such as Wireshark to record the session and observe user agent strings and responses.

Inspired by APTSimulator - https://github.com/NextronSystems/APTSimulator/blob/master/test-sets/command-and-control/malicious-user-agents.bat

**Supported Platforms:** windows

```powershell
Invoke-WebRequest #{domain} -UserAgent "HttpBrowser/1.0" | out-null
Invoke-WebRequest #{domain} -UserAgent "Wget/1.9+cvs-stable (Red Hat modified)" | out-null
Invoke-WebRequest #{domain} -UserAgent "Opera/8.81 (Windows NT 6.0; U; en)" | out-null
Invoke-WebRequest #{domain} -UserAgent "*<|>*" | out-null
```

### Atomic Test 2: Malicious User Agents - CMD

This test simulates an infected host beaconing to command and control. Upon execution, no out put will be displayed.
Use an application such as Wireshark to record the session and observe user agent strings and responses.

Inspired by APTSimulator - https://github.com/NextronSystems/APTSimulator/blob/master/test-sets/command-and-control/malicious-user-agents.bat

**Supported Platforms:** windows

```cmd
#{curl_path} -s -A "HttpBrowser/1.0" -m3 #{domain} >nul 2>&1
#{curl_path} -s -A "Wget/1.9+cvs-stable (Red Hat modified)" -m3 #{domain} >nul 2>&1
#{curl_path} -s -A "Opera/8.81 (Windows NT 6.0; U; en)" -m3 #{domain} >nul 2>&1
#{curl_path} -s -A "*<|>*" -m3 #{domain} >nul 2>&1
```

**Dependencies:**

- Curl must be installed on system

### Atomic Test 3: Malicious User Agents - Nix

This test simulates an infected host beaconing to command and control.
Inspired by APTSimulator - https://github.com/NextronSystems/APTSimulator/blob/master/test-sets/command-and-control/malicious-user-agents.bat

**Supported Platforms:** linux, macos

```bash
curl -s -A "HttpBrowser/1.0" -m3 #{domain}
curl -s -A "Wget/1.9+cvs-stable (Red Hat modified)" -m3 #{domain}
curl -s -A "Opera/8.81 (Windows NT 6.0; U; en)" -m3 #{domain}
curl -s -A "*<|>*" -m3 #{domain}
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Web Protocols by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1071.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level.

### M1037 Filter Network Traffic

Restrict and monitor outbound web traffic (HTTP/HTTPS) from critical servers to only approved destinations. Limiting the ability to initiate outbound HTTP/HTTPS connections, especially from public-facing servers, can prevent attackers from using tools like curl or wget to communicate with external C2 servers or download malicious payloads.

## Detection

### Detection of Web Protocol-Based C2 Over HTTP, HTTPS, or WebSockets

## Risk Assessment

| Finding                            | Severity | Impact              |
| ---------------------------------- | -------- | ------------------- |
| Web Protocols technique applicable | Low      | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [CrowdStrike Putter Panda](http://cdn0.vox-cdn.com/assets/4589853/crowdstrike-intelligence-report-putter-panda.original.pdf)
- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Brazking-Websockets](https://securityintelligence.com/posts/brazking-android-malware-upgraded-targeting-brazilian-banks/)
- [Atomic Red Team - T1071.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1071.001)
- [MITRE ATT&CK - T1071.001](https://attack.mitre.org/techniques/T1071/001)
