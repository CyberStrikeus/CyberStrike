---
name: "T1090.003_multi-hop-proxy"
description: "Adversaries may chain together multiple proxies to disguise the source of malicious traffic."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1090.003
  - command-and-control
  - esxi
  - linux
  - macos
  - network-devices
  - windows
  - sub-technique
technique_id: "T1090.003"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1090/003"
tech_stack:
  - esxi
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-300
chains_with:
  - T1090
  - T1090.001
  - T1090.002
  - T1090.004
prerequisites:
  - T1090
severity_boost:
  T1090: "Chain with T1090 for deeper attack path"
  T1090.001: "Chain with T1090.001 for deeper attack path"
  T1090.002: "Chain with T1090.002 for deeper attack path"
---

# T1090.003 Multi-hop Proxy

> **Sub-technique of:** T1090

## High-Level Description

Adversaries may chain together multiple proxies to disguise the source of malicious traffic. Typically, a defender will be able to identify the last proxy traffic traversed before it enters their network; the defender may or may not be able to identify any previous proxies before the last-hop proxy. This technique makes identifying the original source of the malicious traffic even more difficult by requiring the defender to trace malicious traffic through several proxies to identify its source.

For example, adversaries may construct or use onion routing networks – such as the publicly available Tor network – to transport encrypted C2 traffic through a compromised population, allowing communication with any device within the network. Adversaries may also use operational relay box (ORB) networks composed of virtual private servers (VPS), Internet of Things (IoT) devices, smart devices, and end-of-life routers to obfuscate their operations.

In the case of network infrastructure, it is possible for an adversary to leverage multiple compromised devices to create a multi-hop proxy chain (i.e., Network Devices). By leveraging Patch System Image on routers, adversaries can add custom code to the affected network devices that will implement onion routing between those nodes. This method is dependent upon the Network Boundary Bridging method allowing the adversaries to cross the protected network boundary of the Internet perimeter and into the organization’s Wide-Area Network (WAN). Protocols such as ICMP may be used as a transport.

Similarly, adversaries may abuse peer-to-peer (P2P) and blockchain-oriented infrastructure to implement routing between a decentralized network of peers.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Multi-hop Proxy technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Multi-hop Proxy
- [ ] Check Linux systems for indicators of Multi-hop Proxy
- [ ] Check macOS systems for indicators of Multi-hop Proxy
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Psiphon

Psiphon 3 is a circumvention tool from Psiphon Inc. that utilizes VPN, SSH and HTTP Proxy technology to provide you
with uncensored access to Internet.
This process will launch Psiphon 3 and establish a connection. Shortly after it will be shut down via process kill commands.
More information can be found about Psiphon using the following urls
http://s3.amazonaws.com/0ubz-2q11-gi9y/en.html
https://psiphon.ca/faq.html

**Supported Platforms:** windows

```powershell
& "PathToAtomicsFolder\T1090.003\src\Psiphon.bat"
```

**Dependencies:**

- The proxy settings backup file must exist on disk at $env:Temp\proxy-backup.txt
- The Psiphon executable must exist in the Downloads folder
- Batch file containing commands to run must be in src directory

### Atomic Test 2: Tor Proxy Usage - Windows

This test is designed to launch the tor proxy service, which is what is utilized in the background by the Tor Browser and other applications with add-ons in order to provide onion routing functionality.
Upon successful execution, the tor proxy will be launched, run for 60 seconds, and then exit.

**Supported Platforms:** windows

```powershell
invoke-expression 'cmd /c start powershell -Command {cmd /c "#{TorExe}"}'
sleep -s 60
stop-process -name "tor" | out-null
```

**Dependencies:**

- tor.exe must be installed on the machine

### Atomic Test 3: Tor Proxy Usage - Debian/Ubuntu/FreeBSD

This test is designed to launch the tor proxy service, which is what is utilized in the background by the Tor Browser and other applications with add-ons in order to provide onion routing functionality.
Upon successful execution, the tor proxy service will be launched.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
[ "$(uname)" = 'FreeBSD' ] && sysrc tor_enable="YES" && service tor start || sudo systemctl start tor
```

**Dependencies:**

- Tor must be installed on the machine

### Atomic Test 4: Tor Proxy Usage - MacOS

This test is designed to launch the tor proxy service, which is what is utilized in the background by the Tor Browser and other applications with add-ons in order to provide onion routing functionality.
Upon successful execution, the tor proxy service will be launched.

**Supported Platforms:** macos

```bash
osascript -e 'tell application "Terminal" to do script "tor"'
```

**Dependencies:**

- Tor must be installed on the machine

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Multi-hop Proxy by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1090.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1037 Filter Network Traffic

Traffic to known anonymity networks and C2 infrastructure can be blocked through the use of network allow and block lists. It should be noted that this kind of blocking may be circumvented by other techniques like Domain Fronting.

## Detection

### Multi-hop Proxy Behavior via Relay Node Chaining, Onion Routing, and Network Tunneling

## Risk Assessment

| Finding                              | Severity | Impact              |
| ------------------------------------ | -------- | ------------------- |
| Multi-hop Proxy technique applicable | Medium   | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [ORB Mandiant](https://cloud.google.com/blog/topics/threat-intelligence/china-nexus-espionage-orb-networks)
- [NGLite Trojan](https://unit42.paloaltonetworks.com/manageengine-godzilla-nglite-kdcsponge/)
- [Onion Routing](https://en.wikipedia.org/wiki/Onion_routing)
- [Atomic Red Team - T1090.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1090.003)
- [MITRE ATT&CK - T1090.003](https://attack.mitre.org/techniques/T1090/003)
