---
name: "T1530_data-from-cloud-storage"
description: "Adversaries may access data from cloud storage."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1530
  - collection
  - iaas
  - office-suite
  - saas
technique_id: "T1530"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - IaaS
  - Office Suite
  - SaaS
mitre_url: "https://attack.mitre.org/techniques/T1530"
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

# T1530 Data from Cloud Storage

## High-Level Description

Adversaries may access data from cloud storage.

Many IaaS providers offer solutions for online data object storage such as Amazon S3, Azure Storage, and Google Cloud Storage. Similarly, SaaS enterprise platforms such as Office 365 and Google Workspace provide cloud-based document storage to users through services such as OneDrive and Google Drive, while SaaS application providers such as Slack, Confluence, Salesforce, and Dropbox may provide cloud storage solutions as a peripheral or primary use case of their platform. 

In some cases, as with IaaS-based cloud storage, there exists no overarching application (such as SQL or Elasticsearch) with which to interact with the stored objects: instead, data from these solutions is retrieved directly though the Cloud API. In SaaS applications, adversaries may be able to collect this data directly from APIs or backend cloud storage objects, rather than through their front-end application or interface (i.e., Data from Information Repositories). 

Adversaries may collect sensitive data from these cloud storage solutions. Providers typically offer security guides to help end users configure systems, though misconfigurations are a common problem. There have been numerous incidents where cloud storage has been improperly secured, typically by unintentionally allowing public access to unauthenticated users, overly-broad access by all users, or even access for any anonymous person outside the control of the Identity Access Management system without even needing basic user permissions.

This open access may expose various types of sensitive data, such as credit cards, personally identifiable information, or medical records.

Adversaries may also obtain then abuse leaked credentials from source repositories, logs, or other means as a way to gain access to cloud storage objects.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** IaaS, Office Suite, SaaS

## What to Check

- [ ] Identify if Data from Cloud Storage technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Data from Cloud Storage
- [ ] Check Office Suite systems for indicators of Data from Cloud Storage
- [ ] Check SaaS systems for indicators of Data from Cloud Storage
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Data from Cloud Storage by examining the target platforms (IaaS, Office Suite, SaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1530 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management
Configure user permissions groups and roles for access to cloud storage. Implement strict Identity and Access Management (IAM) controls to prevent access to storage solutions except for the applications, users, and services that require access. Ensure that temporary access tokens are issued rather than permanent credentials, especially when access is being granted to entities outside of the internal security boundary.

### M1041 Encrypt Sensitive Information
Encrypt data stored at rest in cloud storage. Managed encryption keys can be rotated by most providers. At a minimum, ensure an incident response plan to storage breach includes rotating the keys and test for impact on client applications.

### M1022 Restrict File and Directory Permissions
Use access control lists on storage systems and objects.

### M1037 Filter Network Traffic
Cloud service providers support IP-based restrictions when accessing cloud resources. Consider using IP allowlisting along with user account management to ensure that data access is restricted not only to valid users but only from expected IP ranges to mitigate the use of stolen credentials to access data.

### M1047 Audit
Frequently check permissions on cloud storage to ensure proper permissions are set to deny open or unprivileged access to resources.

### M1032 Multi-factor Authentication
Consider using multi-factor authentication to restrict access to resources and cloud storage APIs.


## Detection

### Multi-Platform Cloud Storage Exfiltration Behavior Chain


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Data from Cloud Storage technique applicable | High | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Amazon S3 Security, 2019](https://aws.amazon.com/premiumsupport/knowledge-center/secure-s3-resources/)
- [Microsoft Azure Storage Security, 2019](https://docs.microsoft.com/en-us/azure/storage/common/storage-security-guide)
- [Wired Magecart S3 Buckets, 2019](https://www.wired.com/story/magecart-amazon-cloud-hacks/)
- [Google Cloud Storage Best Practices, 2019](https://cloud.google.com/storage/docs/best-practices)
- [HIPAA Journal S3 Breach, 2017](https://www.hipaajournal.com/47gb-medical-records-unsecured-amazon-s3-bucket/)
- [Rclone-mega-extortion_05_2021](https://redcanary.com/blog/rclone-mega-extortion/)
- [Trend Micro S3 Exposed PII, 2017](https://www.trendmicro.com/vinfo/us/security/news/virtualization-and-cloud/a-misconfigured-amazon-s3-exposed-almost-50-thousand-pii-in-australia)
- [Atomic Red Team - T1530](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1530)
- [MITRE ATT&CK - T1530](https://attack.mitre.org/techniques/T1530)
