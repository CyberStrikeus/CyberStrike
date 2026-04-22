---
name: "T1040_network-sniffing"
description: "Adversaries may passively sniff network traffic to capture information about an environment, including authentication material passed over the network."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1040
  - credential-access
  - discovery
  - linux
  - macos
  - windows
  - network-devices
  - iaas
technique_id: "T1040"
tactic: "credential-access"
all_tactics:
  - credential-access
  - discovery
platforms:
  - Linux
  - macOS
  - Windows
  - Network Devices
  - IaaS
mitre_url: "https://attack.mitre.org/techniques/T1040"
tech_stack:
  - linux
  - macos
  - windows
  - network devices
  - cloud
cwe_ids:
  - CWE-522
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1040 Network Sniffing

## High-Level Description

Adversaries may passively sniff network traffic to capture information about an environment, including authentication material passed over the network. Network sniffing refers to using the network interface on a system to monitor or capture information sent over a wired or wireless connection. An adversary may place a network interface into promiscuous mode to passively access data in transit over the network, or use span ports to capture a larger amount of data.

Data captured via this technique may include user credentials, especially those sent over an insecure, unencrypted protocol. Techniques for name service resolution poisoning, such as LLMNR/NBT-NS Poisoning and SMB Relay, can also be used to capture credentials to websites, proxies, and internal systems by redirecting traffic to an adversary.

Network sniffing may reveal configuration details, such as running services, version numbers, and other network characteristics (e.g. IP addresses, hostnames, VLAN IDs) necessary for subsequent Lateral Movement and/or Defense Evasion activities. Adversaries may likely also utilize network sniffing during Adversary-in-the-Middle (AiTM) to passively gain additional knowledge about the environment.

In cloud-based environments, adversaries may still be able to use traffic mirroring services to sniff network traffic from virtual machines. For example, AWS Traffic Mirroring, GCP Packet Mirroring, and Azure vTap allow users to define specified instances to collect traffic from and specified targets to send collected traffic to. Often, much of this traffic will be in cleartext due to the use of TLS termination at the load balancer level to reduce the strain of encrypting and decrypting traffic. The adversary can then use exfiltration techniques such as Transfer Data to Cloud Account in order to access the sniffed traffic.

On network devices, adversaries may perform network captures using Network Device CLI commands such as `monitor capture`.

## Kill Chain Phase

- Credential Access (TA0006)
- Discovery (TA0007)

**Platforms:** Linux, macOS, Windows, Network Devices, IaaS

## What to Check

- [ ] Identify if Network Sniffing technique is applicable to target environment
- [ ] Check Linux systems for indicators of Network Sniffing
- [ ] Check macOS systems for indicators of Network Sniffing
- [ ] Check Windows systems for indicators of Network Sniffing
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Packet Capture Linux using tshark or tcpdump

Perform a PCAP. Wireshark will be required for tshark. TCPdump may already be installed.

Upon successful execution, tshark or tcpdump will execute and capture 5 packets on interface ens33.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
tcpdump -c 5 -nnni #{interface}
tshark -c 5 -i #{interface}
```

**Dependencies:**
- Check if at least one of tcpdump or tshark is installed.

### Atomic Test 2: Packet Capture FreeBSD using tshark or tcpdump

Perform a PCAP. Wireshark will be required for tshark. TCPdump may already be installed.

Upon successful execution, tshark or tcpdump will execute and capture 5 packets on interface ens33.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
tcpdump -c 5 -nnni #{interface}
tshark -c 5 -i #{interface}
```

**Dependencies:**
- Check if at least one of tcpdump or tshark is installed.

### Atomic Test 3: Packet Capture macOS using tcpdump or tshark

Perform a PCAP on macOS. This will require Wireshark/tshark to be installed. TCPdump may already be installed.

Upon successful execution, tshark or tcpdump will execute and capture 5 packets on interface en0A.

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo tcpdump -c 5 -nnni #{interface}    
if [ -x "$(command -v tshark)" ]; then sudo tshark -c 5 -i #{interface}; fi;
```

**Dependencies:**
- Check if at least one of tcpdump or tshark is installed.

### Atomic Test 4: Packet Capture Windows Command Prompt

Perform a packet capture using the windows command prompt. This will require a host that has Wireshark/Tshark
installed.

Upon successful execution, tshark will execute and capture 5 packets on interface "Ethernet".

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
"c:\Program Files\Wireshark\tshark.exe" -i #{interface} -c 5
```

**Dependencies:**
- tshark must be installed and in the default path of "c:\Program Files\Wireshark\Tshark.exe".
- npcap must be installed.

### Atomic Test 5: Windows Internal Packet Capture

Uses the built-in Windows packet capture
After execution you should find a file named trace.etl and trace.cab in the temp directory

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
netsh trace start capture=yes tracefile=%temp%\trace.etl maxsize=10
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Network Sniffing by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1040 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1018 User Account Management
In cloud environments, ensure that users are not granted permissions to create or modify traffic mirrors unless this is explicitly required.

### M1032 Multi-factor Authentication
Use multi-factor authentication wherever possible.

### M1041 Encrypt Sensitive Information
Ensure that all wired and/or wireless traffic is encrypted appropriately. Use best practices for authentication protocols, such as Kerberos, and ensure web traffic that may contain credentials is protected by SSL/TLS.

### M1030 Network Segmentation
Deny direct access of broadcasts and multicast sniffing, and prevent attacks such as LLMNR/NBT-NS Poisoning and SMB Relay


## Detection

### Detection Strategy for Network Sniffing Across Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Network Sniffing technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [AWS Traffic Mirroring](https://docs.aws.amazon.com/vpc/latest/mirroring/traffic-mirroring-how-it-works.html)
- [capture_embedded_packet_on_software](https://www.cisco.com/c/en/us/support/docs/ios-nx-os-software/ios-embedded-packet-capture/116045-productconfig-epc-00.html)
- [GCP Packet Mirroring](https://cloud.google.com/vpc/docs/packet-mirroring)
- [SpecterOps AWS Traffic Mirroring](https://posts.specterops.io/through-the-looking-glass-part-1-f539ae308512)
- [Azure Virtual Network TAP](https://docs.microsoft.com/en-us/azure/virtual-network/virtual-network-tap-overview)
- [Rhino Security Labs AWS VPC Traffic Mirroring](https://rhinosecuritylabs.com/aws/abusing-vpc-traffic-mirroring-in-aws/)
- [US-CERT-TA18-106A](https://www.us-cert.gov/ncas/alerts/TA18-106A)
- [Atomic Red Team - T1040](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1040)
- [MITRE ATT&CK - T1040](https://attack.mitre.org/techniques/T1040)
