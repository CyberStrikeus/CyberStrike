---
name: "T1562.008_disable-or-modify-cloud-logs"
description: "An adversary may disable or modify cloud logging capabilities and integrations to limit what data is collected on their activities and avoid detection."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1562.008
  - defense-evasion
  - iaas
  - saas
  - office-suite
  - identity-provider
  - sub-technique
technique_id: "T1562.008"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - IaaS
  - SaaS
  - Office Suite
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1562/008"
tech_stack:
  - cloud
  - saas
  - office
  - identity
cwe_ids:
  - CWE-693
chains_with:
  - T1562
  - T1562.001
  - T1562.002
  - T1562.003
  - T1562.004
  - T1562.006
  - T1562.007
  - T1562.009
  - T1562.010
  - T1562.011
  - T1562.012
  - T1562.013
prerequisites:
  - T1562
severity_boost:
  T1562: "Chain with T1562 for deeper attack path"
  T1562.001: "Chain with T1562.001 for deeper attack path"
  T1562.002: "Chain with T1562.002 for deeper attack path"
---

# T1562.008 Disable or Modify Cloud Logs

> **Sub-technique of:** T1562

## High-Level Description

An adversary may disable or modify cloud logging capabilities and integrations to limit what data is collected on their activities and avoid detection. Cloud environments allow for collection and analysis of audit and application logs that provide insight into what activities a user does within the environment. If an adversary has sufficient permissions, they can disable or modify logging to avoid detection of their activities.

For example, in AWS an adversary may disable CloudWatch/CloudTrail integrations prior to conducting further malicious activity. They may alternatively tamper with logging functionality – for example, by removing any associated SNS topics, disabling multi-region logging, or disabling settings that validate and/or encrypt log files. In Office 365, an adversary may disable logging on mail collection activities for specific users by using the `Set-MailboxAuditBypassAssociation` cmdlet, by disabling M365 Advanced Auditing for the user, or by downgrading the user’s license from an Enterprise E5 to an Enterprise E3 license.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** IaaS, SaaS, Office Suite, Identity Provider

## What to Check

- [ ] Identify if Disable or Modify Cloud Logs technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Disable or Modify Cloud Logs
- [ ] Check SaaS systems for indicators of Disable or Modify Cloud Logs
- [ ] Check Office Suite systems for indicators of Disable or Modify Cloud Logs
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Disable or Modify Cloud Logs by examining the target platforms (IaaS, SaaS, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1562.008 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management

Configure default account policy to enable logging. Manage policies to ensure only necessary users have permissions to make changes to logging policies.

## Detection

### Detection Strategy for Disable or Modify Cloud Logs

## Risk Assessment

| Finding                                           | Severity | Impact          |
| ------------------------------------------------- | -------- | --------------- |
| Disable or Modify Cloud Logs technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Stopping CloudTrail from Sending Events to CloudWatch Logs](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/stop-cloudtrail-from-sending-events-to-cloudwatch-logs.html)
- [AWS Update Trail](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/cloudtrail/update-trail.html)
- [Following the CloudTrail: Generating strong AWS security signals with Sumo Logic](https://expel.io/blog/following-cloudtrail-generating-aws-security-signals-sumo-logic/)
- [Configuring Data Access audit logs](https://cloud.google.com/logging/docs/audit/configure-data-access)
- [Dark Reading Microsoft 365 Attacks 2021](https://www.darkreading.com/threat-intelligence/incident-responders-explore-microsoft-365-attacks-in-the-wild/d/d-id/1341591)
- [az monitor diagnostic-settings](https://docs.microsoft.com/en-us/cli/azure/monitor/diagnostic-settings?view=azure-cli-latest#az_monitor_diagnostic_settings_delete)
- [Pacu Detection Disruption Module](https://github.com/RhinoSecurityLabs/pacu/blob/master/pacu/modules/detection__disruption/main.py)
- [Atomic Red Team - T1562.008](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1562.008)
- [MITRE ATT&CK - T1562.008](https://attack.mitre.org/techniques/T1562/008)
