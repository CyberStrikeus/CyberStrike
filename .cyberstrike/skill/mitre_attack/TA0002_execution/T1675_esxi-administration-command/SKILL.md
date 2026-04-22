---
name: "T1675_esxi-administration-command"
description: "Adversaries may abuse ESXi administration services to execute commands on guest machines hosted within an ESXi virtual environment."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1675
  - execution
  - esxi
technique_id: "T1675"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1675"
tech_stack:
  - esxi
cwe_ids:
  - CWE-94
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1675 ESXi Administration Command

## High-Level Description

Adversaries may abuse ESXi administration services to execute commands on guest machines hosted within an ESXi virtual environment. Persistent background services on ESXi-hosted VMs, such as the VMware Tools Daemon Service, allow for remote management from the ESXi server. The tools daemon service runs as `vmtoolsd.exe` on Windows guest operating systems, `vmware-tools-daemon` on macOS, and `vmtoolsd ` on Linux.

Adversaries may leverage a variety of tools to execute commands on ESXi-hosted VMs – for example, by using the vSphere Web Services SDK to programmatically execute commands and scripts via APIs such as `StartProgramInGuest`, `ListProcessesInGuest`, `ListFileInGuest`, and `InitiateFileTransferFromGuest`. This may enable follow-on behaviors on the guest VMs, such as File and Directory Discovery, Data from Local System, or OS Credential Dumping.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** ESXi

## What to Check

- [ ] Identify if ESXi Administration Command technique is applicable to target environment
- [ ] Check ESXi systems for indicators of ESXi Administration Command
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to ESXi Administration Command by examining the target platforms (ESXi).

2. **Assess Existing Defenses**: Review whether mitigations for T1675 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management

If not required, restrict the permissions of users to perform Guest Operations on ESXi-hosted VMs.

## Detection

### Detection Strategy for ESXi Administration Command

## Risk Assessment

| Finding                                          | Severity | Impact    |
| ------------------------------------------------ | -------- | --------- |
| ESXi Administration Command technique applicable | High     | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Google Cloud Threat Intelligence VMWare ESXi Zero-Day 2023](https://cloud.google.com/blog/topics/threat-intelligence/vmware-esxi-zero-day-bypass/)
- [Broadcom Running Guest OS Operations](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere-sdks-tools/8-0/web-services-sdk-programming-guide/virtual-machine-guest-operations/running-guest-os-operations.html)
- [Broadcom VMware Tools Services](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/tools/12-4-0/vmware-tools-administration-12-4-0/introduction-to-vmware-tools/vmware-tools-service.html)
- [Atomic Red Team - T1675](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1675)
- [MITRE ATT&CK - T1675](https://attack.mitre.org/techniques/T1675)
