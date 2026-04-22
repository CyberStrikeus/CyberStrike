---
name: "T1485.001_lifecycle-triggered-deletion"
description: "Adversaries may modify the lifecycle policies of a cloud storage bucket to destroy all objects stored within."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1485.001
  - impact
  - iaas
  - sub-technique
technique_id: "T1485.001"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - IaaS
mitre_url: "https://attack.mitre.org/techniques/T1485/001"
tech_stack:
  - cloud
cwe_ids:
  - CWE-400
chains_with:
  - T1485
prerequisites:
  - T1485
severity_boost:
  T1485: "Chain with T1485 for deeper attack path"
---

# T1485.001 Lifecycle-Triggered Deletion

> **Sub-technique of:** T1485

## High-Level Description

Adversaries may modify the lifecycle policies of a cloud storage bucket to destroy all objects stored within.

Cloud storage buckets often allow users to set lifecycle policies to automate the migration, archival, or deletion of objects after a set period of time. If a threat actor has sufficient permissions to modify these policies, they may be able to delete all objects at once.

For example, in AWS environments, an adversary with the `PutLifecycleConfiguration` permission may use the `PutBucketLifecycle` API call to apply a lifecycle policy to an S3 bucket that deletes all objects in the bucket after one day. In addition to destroying data for purposes of extortion and Financial Theft, adversaries may also perform this action on buckets storing cloud logs for Indicator Removal.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** IaaS

## What to Check

- [ ] Identify if Lifecycle-Triggered Deletion technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Lifecycle-Triggered Deletion
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Lifecycle-Triggered Deletion by examining the target platforms (IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1485.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management

In cloud environments, limit permissions to modify cloud bucket lifecycle policies (e.g., `PutLifecycleConfiguration` in AWS) to only those accounts that require it. In AWS environments, consider using Service Control policies to limit the use of the `PutBucketLifecycle` API call.

### M1053 Data Backup

Consider implementing IT disaster recovery plans that contain procedures for taking regular data backups that can be used to restore organizational data. Ensure backups are stored off system and protected from common methods adversaries may use to gain access and destroy the backups to prevent recovery.

## Detection

### Detection of Lifecycle Policy Modifications for Triggered Deletion in IaaS Cloud Storage

## Risk Assessment

| Finding                                           | Severity | Impact |
| ------------------------------------------------- | -------- | ------ |
| Lifecycle-Triggered Deletion technique applicable | Low      | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [AWS Storage Lifecycles](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)
- [GCP Storage Lifecycles](https://cloud.google.com/storage/docs/lifecycle)
- [Halcyon AWS Ransomware 2025](https://www.halcyon.ai/blog/abusing-aws-native-services-ransomware-encrypting-s3-buckets-with-sse-c)
- [Azure Storage Lifecycles](https://learn.microsoft.com/en-us/azure/storage/blobs/lifecycle-management-policy-configure?tabs=azure-portal)
- [Palo Alto Cloud Ransomware](https://www.paloaltonetworks.com/blog/prisma-cloud/ransomware-data-protection-cloud/)
- [Datadog S3 Lifecycle CloudTrail Logs](https://stratus-red-team.cloud/attack-techniques/AWS/aws.defense-evasion.cloudtrail-lifecycle-rule/)
- [Atomic Red Team - T1485.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1485.001)
- [MITRE ATT&CK - T1485.001](https://attack.mitre.org/techniques/T1485/001)
