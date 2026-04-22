---
name: "T1016_system-network-configuration-discovery"
description: "Adversaries may look for details about the network configuration and settings, such as IP and/or MAC addresses, of systems they access or through information discovery of remote systems."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1016
  - discovery
  - esxi
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1016"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1016"
tech_stack:
  - esxi
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1016.001
  - T1016.002
prerequisites: []
severity_boost:
  T1016.001: "Chain with T1016.001 for deeper attack path"
  T1016.002: "Chain with T1016.002 for deeper attack path"
---

# T1016 System Network Configuration Discovery

## High-Level Description

Adversaries may look for details about the network configuration and settings, such as IP and/or MAC addresses, of systems they access or through information discovery of remote systems. Several operating system administration utilities exist that can be used to gather this information. Examples include Arp, ipconfig/ifconfig, nbtstat, and route.

Adversaries may also leverage a Network Device CLI on network devices to gather information about configurations and settings, such as IP addresses of configured interfaces and static/dynamic routes (e.g. <code>show ip route</code>, <code>show ip interface</code>). On ESXi, adversaries may leverage esxcli to gather network configuration information. For example, the command `esxcli network nic list` will retrieve the MAC address, while `esxcli network ip interface ipv4 get` will retrieve the local IPv4 address.

Adversaries may use the information from System Network Configuration Discovery during automated discovery to shape follow-on behaviors, including determining certain access within the target network and what actions to do next.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if System Network Configuration Discovery technique is applicable to target environment
- [ ] Check ESXi systems for indicators of System Network Configuration Discovery
- [ ] Check Linux systems for indicators of System Network Configuration Discovery
- [ ] Check macOS systems for indicators of System Network Configuration Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: System Network Configuration Discovery on Windows

Identify network configuration information

Upon successful execution, cmd.exe will spawn multiple commands to list network configuration settings. Output will be via stdout.

**Supported Platforms:** windows

```cmd
ipconfig /all
netsh interface show interface
arp -a
nbtstat -n
net config
```

### Atomic Test 2: List Windows Firewall Rules

Enumerates Windows Firewall Rules using netsh.

Upon successful execution, cmd.exe will spawn netsh.exe to list firewall rules. Output will be via stdout.

**Supported Platforms:** windows

```cmd
netsh advfirewall firewall show rule name=all
```

### Atomic Test 3: System Network Configuration Discovery

Identify network configuration information.
Upon successful execution, sh will spawn multiple commands and output will be via stdout.

**Supported Platforms:** macos, linux

```bash
if [ "$(uname)" = 'FreeBSD' ]; then cmd="netstat -Sp tcp"; else cmd="netstat -ant"; fi;
if [ -x "$(command -v arp)" ]; then arp -a; else echo "arp is missing from the machine. skipping..."; fi;
if [ -x "$(command -v ifconfig)" ]; then ifconfig; else echo "ifconfig is missing from the machine. skipping..."; fi;
if [ -x "$(command -v ip)" ]; then ip addr; else echo "ip is missing from the machine. skipping..."; fi;
if [ -x "$(command -v netstat)" ]; then $cmd | awk '{print $NF}' | grep -v '[[:lower:]]' | sort | uniq -c; else echo "netstat is missing from the machine. skipping..."; fi;
```

**Dependencies:**

- Check if arp command exists on the machine

### Atomic Test 4: System Network Configuration Discovery (TrickBot Style)

Identify network configuration information as seen by Trickbot and described here https://www.sneakymonkey.net/2019/10/29/trickbot-analysis-part-ii/

Upon successful execution, cmd.exe will spawn `ipconfig /all`, `net config workstation`, `net view /all /domain`, `nltest /domain_trusts`. Output will be via stdout.

**Supported Platforms:** windows

```cmd
ipconfig /all
net config workstation
net view /all /domain
nltest /domain_trusts
```

### Atomic Test 5: List Open Egress Ports

This is to test for what ports are open outbound. The technique used was taken from the following blog:
https://www.blackhillsinfosec.com/poking-holes-in-the-firewall-egress-testing-with-allports-exposed/

Upon successful execution, powershell will read top-128.txt (ports) and contact each port to confirm if open or not. Output will be to Desktop\open-ports.txt.

**Supported Platforms:** windows

```powershell
$ports = Get-content "#{port_file}"
$file = "#{output_file}"
$totalopen = 0
$totalports = 0
New-Item $file -Force
foreach ($port in $ports) {
    $test = new-object system.Net.Sockets.TcpClient
    $wait = $test.beginConnect("allports.exposed", $port, $null, $null)
    $wait.asyncwaithandle.waitone(250, $false) | Out-Null
    $totalports++ | Out-Null
    if ($test.Connected) {
        $result = "$port open"
        Write-Host -ForegroundColor Green $result
        $result | Out-File -Encoding ASCII -append $file
        $totalopen++ | Out-Null
    }
    else {
        $result = "$port closed"
        Write-Host -ForegroundColor Red $result
        $totalclosed++ | Out-Null
        $result | Out-File -Encoding ASCII -append $file
    }
}
$results = "There were a total of $totalopen open ports out of $totalports ports tested."
$results | Out-File -Encoding ASCII -append $file
Write-Host $results
```

**Dependencies:**

- Test requires #{port_file} to exist

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to System Network Configuration Discovery by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1016 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Behavioral Detection of System Network Configuration Discovery

## Risk Assessment

| Finding                                                     | Severity | Impact    |
| ----------------------------------------------------------- | -------- | --------- |
| System Network Configuration Discovery technique applicable | Medium   | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Mandiant APT41 Global Intrusion ](https://www.mandiant.com/resources/apt41-initiates-global-intrusion-campaign-using-multiple-exploits)
- [Trellix Rnasomhouse 2024](https://www.trellix.com/en-au/blogs/research/ransomhouse-am-see/)
- [US-CERT-TA18-106A](https://www.us-cert.gov/ncas/alerts/TA18-106A)
- [Atomic Red Team - T1016](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1016)
- [MITRE ATT&CK - T1016](https://attack.mitre.org/techniques/T1016)
