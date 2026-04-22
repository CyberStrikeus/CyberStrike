---
name: "T1486_data-encrypted-for-impact"
description: "Adversaries may encrypt data on target systems or on large numbers of systems in a network to interrupt availability to system and network resources."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1486
  - impact
  - esxi
  - iaas
  - linux
  - macos
  - windows
technique_id: "T1486"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - ESXi
  - IaaS
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1486"
tech_stack:
  - esxi
  - cloud
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-400
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1486 Data Encrypted for Impact

## High-Level Description

Adversaries may encrypt data on target systems or on large numbers of systems in a network to interrupt availability to system and network resources. They can attempt to render stored data inaccessible by encrypting files or data on local and remote drives and withholding access to a decryption key. This may be done in order to extract monetary compensation from a victim in exchange for decryption or a decryption key (ransomware) or to render data permanently inaccessible in cases where the key is not saved or transmitted.

In the case of ransomware, it is typical that common user files like Office documents, PDFs, images, videos, audio, text, and source code files will be encrypted (and often renamed and/or tagged with specific file markers). Adversaries may need to first employ other behaviors, such as File and Directory Permissions Modification or System Shutdown/Reboot, in order to unlock and/or gain access to manipulate these files. In some cases, adversaries may encrypt critical system files, disk partitions, and the MBR. Adversaries may also encrypt virtual machines hosted on ESXi or other hypervisors. 

To maximize impact on the target organization, malware designed for encrypting data may have worm-like features to propagate across a network by leveraging other attack techniques like Valid Accounts, OS Credential Dumping, and SMB/Windows Admin Shares. Encryption malware may also leverage Internal Defacement, such as changing victim wallpapers or ESXi server login messages, or otherwise intimidate victims by sending ransom notes or other messages to connected printers (known as "print bombing").

In cloud environments, storage objects within compromised accounts may also be encrypted. For example, in AWS environments, adversaries may leverage services such as AWS’s Server-Side Encryption with Customer Provided Keys (SSE-C) to encrypt data.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** ESXi, IaaS, Linux, macOS, Windows

## What to Check

- [ ] Identify if Data Encrypted for Impact technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Data Encrypted for Impact
- [ ] Check IaaS systems for indicators of Data Encrypted for Impact
- [ ] Check Linux systems for indicators of Data Encrypted for Impact
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Encrypt files using gpg (FreeBSD/Linux)

Uses gpg to encrypt a file

**Supported Platforms:** linux

```bash
echo "#{pwd_for_encrypted_file}" | $which_gpg --batch --yes --passphrase-fd 0 --cipher-algo #{encryption_alg} -o #{encrypted_file_path} -c #{input_file_path}
```

**Dependencies:**
- Finds where gpg is located

### Atomic Test 2: Encrypt files using 7z (FreeBSD/Linux)

Uses 7z to encrypt a file

**Supported Platforms:** linux

```bash
$which_7z a -p#{pwd_for_encrypted_file} #{encrypted_file_path} #{input_file_path}
```

**Dependencies:**
- Finds where 7z is located

### Atomic Test 3: Encrypt files using ccrypt (FreeBSD/Linux)

Attempts to encrypt data on target systems as root to simulate an interruption authentication to target system. If root permissions are not available then attempts to encrypt data within user's home directory.

**Supported Platforms:** linux

```bash
which_ccencrypt=`which ccencrypt`
cp #{root_input_file_path} #{cped_file_path};
$which_ccencrypt -T -K #{pwd_for_encrypted_file} #{cped_file_path}
```

**Dependencies:**
- Finds where ccencrypt and ccdecrypt are located

### Atomic Test 4: Encrypt files using openssl (FreeBSD/Linux)

Uses openssl to encrypt a file

**Supported Platforms:** linux

```bash
which_openssl=`which openssl`
$which_openssl genrsa -out #{private_key_path} #{encryption_bit_size}
$which_openssl rsa -in #{private_key_path} -pubout -out #{public_key_path}
$which_openssl rsautl -encrypt -inkey #{public_key_path} -pubin -in #{input_file_path} -out #{encrypted_file_path}
```

**Dependencies:**
- Finds where openssl is located

### Atomic Test 5: PureLocker Ransom Note

building the IOC (YOUR_FILES.txt) for the PureLocker ransomware 
https://www.bleepingcomputer.com/news/security/purelocker-ransomware-can-lock-files-on-windows-linux-and-macos/

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
echo T1486 - Purelocker Ransom Note > %USERPROFILE%\Desktop\YOUR_FILES.txt
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Data Encrypted for Impact by examining the target platforms (ESXi, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1486 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint
On Windows 10, enable cloud-delivered protection and Attack Surface Reduction (ASR) rules to block the execution of files that resemble ransomware. In AWS environments, create an IAM policy to restrict or block the use of SSE-C on S3 buckets.

### M1053 Data Backup
Consider implementing IT disaster recovery plans that contain procedures for regularly taking and testing data backups that can be used to restore organizational data. Ensure backups are stored off system and is protected from common methods adversaries may use to gain access and destroy the backups to prevent recovery. Consider enabling versioning in cloud environments to maintain backup copies of storage objects.


## Detection

### Detection of Multi-Platform File Encryption for Impact


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Data Encrypted for Impact technique applicable | High | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [CarbonBlack Conti July 2020](https://www.carbonblack.com/blog/tau-threat-discovery-conti-ransomware/)
- [FireEye WannaCry 2017](https://www.fireeye.com/blog/threat-research/2017/05/wannacry-malware-profile.html)
- [Rhino S3 Ransomware Part 1](https://rhinosecuritylabs.com/aws/s3-ransomware-part-1-attack-vector/)
- [Halcyon AWS Ransomware 2025](https://www.halcyon.ai/blog/abusing-aws-native-services-ransomware-encrypting-s3-buckets-with-sse-c)
- [Varonis](https://www.varonis.com/blog/vmware-esxi-in-the-line-of-ransomware-fire)
- [Crowdstrike Hypervisor Jackpotting Pt 2 2021](https://www.crowdstrike.com/en-us/blog/hypervisor-jackpotting-ecrime-actors-increase-targeting-of-esxi-servers/)
- [NHS Digital Egregor Nov 2020](https://digital.nhs.uk/cyber-alerts/2020/cc-3681#summary)
- [US-CERT Ransomware 2016](https://www.us-cert.gov/ncas/alerts/TA16-091A)
- [US-CERT NotPetya 2017](https://www.us-cert.gov/ncas/alerts/TA17-181A)
- [US-CERT SamSam 2018](https://www.us-cert.gov/ncas/alerts/AA18-337A)
- [Atomic Red Team - T1486](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1486)
- [MITRE ATT&CK - T1486](https://attack.mitre.org/techniques/T1486)
