---
name: "T1537_transfer-data-to-cloud-account"
description: "Adversaries may exfiltrate data by transferring the data, including through sharing/syncing and creating backups of cloud environments, to another cloud account they control on the same service."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1537
  - exfiltration
  - iaas
  - office-suite
  - saas
technique_id: "T1537"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - IaaS
  - Office Suite
  - SaaS
mitre_url: "https://attack.mitre.org/techniques/T1537"
tech_stack:
  - cloud
  - office
  - saas
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1537 Transfer Data to Cloud Account

## High-Level Description

Adversaries may exfiltrate data by transferring the data, including through sharing/syncing and creating backups of cloud environments, to another cloud account they control on the same service.

A defender who is monitoring for large transfers to outside the cloud environment through normal file transfers or over command and control channels may not be watching for data transfers to another account within the same cloud provider. Such transfers may utilize existing cloud provider APIs and the internal address space of the cloud provider to blend into normal traffic or avoid data transfers over external network interfaces.

Adversaries may also use cloud-native mechanisms to share victim data with adversary-controlled cloud accounts, such as creating anonymous file sharing links or, in Azure, a shared access signature (SAS) URI.

Incidents have been observed where adversaries have created backups of cloud instances and transferred them to separate accounts.

## Kill Chain Phase

- Exfiltration (TA0010)

**Platforms:** IaaS, Office Suite, SaaS

## What to Check

- [ ] Identify if Transfer Data to Cloud Account technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Transfer Data to Cloud Account
- [ ] Check Office Suite systems for indicators of Transfer Data to Cloud Account
- [ ] Check SaaS systems for indicators of Transfer Data to Cloud Account
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Transfer Data to Cloud Account by examining the target platforms (IaaS, Office Suite, SaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1537 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1057 Data Loss Prevention
Data loss prevention can prevent and block sensitive data from being shared with individuals outside an organization.

### M1018 User Account Management
Limit user account and IAM policies to the least privileges required.

### M1054 Software Configuration
Configure appropriate data sharing restrictions in cloud services. For example, external sharing in Microsoft SharePoint and Google Drive can be turned off altogether, blocked for certain domains, or restricted to certain users.

### M1037 Filter Network Traffic
Implement network-based filtering restrictions to prohibit data transfers to untrusted VPCs.


## Detection

### Cross-Platform Detection of Data Transfer to Cloud Account


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Transfer Data to Cloud Account technique applicable | Low | Exfiltration |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [AWS EBS Snapshot Sharing](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ebs-modifying-snapshot-permissions.html)
- [TLDRSec AWS Attacks](https://tldrsec.com/p/blog-lesser-known-aws-attacks)
- [Azure Shared Access Signature](https://docs.microsoft.com/en-us/rest/api/storageservices/delegate-access-with-shared-access-signature)
- [Azure Blob Snapshots](https://docs.microsoft.com/en-us/azure/storage/blobs/snapshots-overview)
- [Microsoft Azure Storage Shared Access Signature](https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview)
- [DOJ GRU Indictment Jul 2018](https://cdn.cnn.com/cnn/2018/images/07/13/gru.indictment.pdf)
- [Atomic Red Team - T1537](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1537)
- [MITRE ATT&CK - T1537](https://attack.mitre.org/techniques/T1537)
