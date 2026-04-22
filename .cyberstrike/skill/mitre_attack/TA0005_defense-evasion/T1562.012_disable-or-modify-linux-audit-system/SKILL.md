---
name: "T1562.012_disable-or-modify-linux-audit-system"
description: "Adversaries may disable or modify the Linux audit system to hide malicious activity and avoid detection."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1562.012
  - defense-evasion
  - linux
  - sub-technique
technique_id: "T1562.012"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1562/012"
tech_stack:
  - linux
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
  - T1562.008
  - T1562.009
  - T1562.010
  - T1562.011
  - T1562.013
prerequisites:
  - T1562
severity_boost:
  T1562: "Chain with T1562 for deeper attack path"
  T1562.001: "Chain with T1562.001 for deeper attack path"
  T1562.002: "Chain with T1562.002 for deeper attack path"
---

# T1562.012 Disable or Modify Linux Audit System

> **Sub-technique of:** T1562

## High-Level Description

Adversaries may disable or modify the Linux audit system to hide malicious activity and avoid detection. Linux admins use the Linux Audit system to track security-relevant information on a system. The Linux Audit system operates at the kernel-level and maintains event logs on application and system activity such as process, network, file, and login events based on pre-configured rules.

Often referred to as `auditd`, this is the name of the daemon used to write events to disk and is governed by the parameters set in the `audit.conf` configuration file. Two primary ways to configure the log generation rules are through the command line `auditctl` utility and the file `/etc/audit/audit.rules`, containing a sequence of `auditctl` commands loaded at boot time.

With root privileges, adversaries may be able to ensure their activity is not logged through disabling the Audit system service, editing the configuration/rule files, or by hooking the Audit system library functions. Using the command line, adversaries can disable the Audit system service through killing processes associated with `auditd` daemon or use `systemctl` to stop the Audit service. Adversaries can also hook Audit system functions to disable logging or modify the rules contained in the `/etc/audit/audit.rules` or `audit.conf` files to ignore malicious activity.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux

## What to Check

- [ ] Identify if Disable or Modify Linux Audit System technique is applicable to target environment
- [ ] Check Linux systems for indicators of Disable or Modify Linux Audit System
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Delete all auditd rules using auditctl

Using 'auditctl -D' deletes all existing audit rules, resulting in the loss of previously configured monitoring settings and the audit trail. This action reduces visibility into system activities, potentially leading to compliance concerns and hampering security monitoring efforts. Additionally, it poses a risk of covering unauthorized activities by erasing evidence from audit logs.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
auditctl -D
```

**Dependencies:**

- Check if auditd is installed.

### Atomic Test 2: Disable auditd using auditctl

The command `auditctl -e 0` disables the audit system. By setting the parameter to `0`, auditing is deactivated, halting the monitoring and recording of security-related events. This action stops the generation of audit logs, ceasing the collection of data regarding system activities. Disabling auditing may be done for various reasons, such as troubleshooting, performance optimization, or temporarily suspending auditing requirements, but it reduces visibility into system events and can impact security monitoring and compliance efforts.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
auditctl -e 0
```

**Dependencies:**

- Check if auditd is installed.

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Disable or Modify Linux Audit System by examining the target platforms (Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1562.012 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1047 Audit

Routinely check account role permissions to ensure only expected users and roles have permission to modify logging settings.

To ensure Audit rules can not be modified at runtime, add the `auditctl -e 2` as the last command in the audit.rules files. Once started, any attempt to change the configuration in this mode will be audited and denied. The configuration can only be changed by rebooting the machine.

### M1018 User Account Management

An adversary must already have root level access on the local system to make full use of this technique; be sure to restrict users and accounts to the least privileges they require.

## Detection

### Detection Strategy for Disable or Modify Linux Audit System

## Risk Assessment

| Finding                                                   | Severity | Impact          |
| --------------------------------------------------------- | -------- | --------------- |
| Disable or Modify Linux Audit System technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [IzyKnows auditd threat detection 2022](https://izyknows.medium.com/linux-auditd-for-threat-detection-d06c8b941505)
- [Red Hat System Auditing](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/6/html/security_guide/chap-system_auditing)
- [ESET Ebury Feb 2014](https://www.welivesecurity.com/2014/02/21/an-in-depth-analysis-of-linuxebury/)
- [Trustwave Honeypot SkidMap 2023](https://www.trustwave.com/en-us/resources/blogs/spiderlabs-blog/honeypot-recon-new-variant-of-skidmap-targeting-redis/)
- [Atomic Red Team - T1562.012](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1562.012)
- [MITRE ATT&CK - T1562.012](https://attack.mitre.org/techniques/T1562/012)
