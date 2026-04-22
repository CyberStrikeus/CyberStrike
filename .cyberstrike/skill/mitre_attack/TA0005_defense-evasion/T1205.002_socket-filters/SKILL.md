---
name: "T1205.002_socket-filters"
description: "Adversaries may attach filters to a network socket to monitor then activate backdoors used for persistence or command and control."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1205.002
  - defense-evasion
  - persistence
  - command-and-control
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1205.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - persistence
  - command-and-control
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1205/002"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1205
  - T1205.001
prerequisites:
  - T1205
severity_boost:
  T1205: "Chain with T1205 for deeper attack path"
  T1205.001: "Chain with T1205.001 for deeper attack path"
---

# T1205.002 Socket Filters

> **Sub-technique of:** T1205

## High-Level Description

Adversaries may attach filters to a network socket to monitor then activate backdoors used for persistence or command and control. With elevated permissions, adversaries can use features such as the `libpcap` library to open sockets and install filters to allow or disallow certain types of data to come through the socket. The filter may apply to all traffic passing through the specified network interface (or every interface if not specified). When the network interface receives a packet matching the filter criteria, additional actions can be triggered on the host, such as activation of a reverse shell.

To establish a connection, an adversary sends a crafted packet to the targeted host that matches the installed filter criteria. Adversaries have used these socket filters to trigger the installation of implants, conduct ping backs, and to invoke command shells. Communication with these socket filters may also be used in conjunction with Protocol Tunneling.

Filters can be installed on any Unix-like platform with `libpcap` installed or on Windows hosts using `Winpcap`. Adversaries may use either `libpcap` with `pcap_setfilter` or the standard library function `setsockopt` with `SO_ATTACH_FILTER` options. Since the socket connection is not active until the packet is received, this behavior may be difficult to detect due to the lack of activity on a host, low CPU overhead, and limited visibility into raw socket usage.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Persistence (TA0003)
- Command and Control (TA0011)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Socket Filters technique is applicable to target environment
- [ ] Check Linux systems for indicators of Socket Filters
- [ ] Check macOS systems for indicators of Socket Filters
- [ ] Check Windows systems for indicators of Socket Filters
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Socket Filters by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1205.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1037 Filter Network Traffic

Mitigation of some variants of this technique could be achieved through the use of stateful firewalls, depending upon how it is implemented.

## Detection

### Socket-filter trigger → on-host raw-socket activity → reverse connection (T1205.002)

## Risk Assessment

| Finding                             | Severity | Impact          |
| ----------------------------------- | -------- | --------------- |
| Socket Filters technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [exatrack bpf filters passive backdoors](https://exatrack.com/public/Tricephalic_Hellkeeper.pdf)
- [crowdstrike bpf socket filters](https://www.crowdstrike.com/blog/how-to-hunt-for-decisivearchitect-and-justforfun-implant/)
- [Leonardo Turla Penquin May 2020](https://www.leonardo.com/documents/20142/10868623/Malware+Technical+Insight+_Turla+%E2%80%9CPenquin_x64%E2%80%9D.pdf)
- [haking9 libpcap network sniffing](http://recursos.aldabaknocking.com/libpcapHakin9LuisMartinGarcia.pdf)
- [Atomic Red Team - T1205.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1205.002)
- [MITRE ATT&CK - T1205.002](https://attack.mitre.org/techniques/T1205/002)
