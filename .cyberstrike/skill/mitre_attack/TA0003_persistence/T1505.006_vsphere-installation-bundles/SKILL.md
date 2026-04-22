---
name: "T1505.006_vsphere-installation-bundles"
description: "Adversaries may abuse vSphere Installation Bundles (VIBs) to establish persistent access to ESXi hypervisors."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1505.006
  - persistence
  - esxi
  - sub-technique
technique_id: "T1505.006"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1505/006"
tech_stack:
  - esxi
cwe_ids:
  - CWE-276
chains_with:
  - T1505
  - T1505.001
  - T1505.002
  - T1505.003
  - T1505.004
  - T1505.005
prerequisites:
  - T1505
severity_boost:
  T1505: "Chain with T1505 for deeper attack path"
  T1505.001: "Chain with T1505.001 for deeper attack path"
  T1505.002: "Chain with T1505.002 for deeper attack path"
---

# T1505.006 vSphere Installation Bundles

> **Sub-technique of:** T1505

## High-Level Description

Adversaries may abuse vSphere Installation Bundles (VIBs) to establish persistent access to ESXi hypervisors. VIBs are collections of files used for software distribution and virtual system management in VMware environments. Since ESXi uses an in-memory filesystem where changes made to most files are stored in RAM rather than in persistent storage, these modifications are lost after a reboot. However, VIBs can be used to create startup tasks, apply custom firewall rules, or deploy binaries that persist across reboots. Typically, administrators use VIBs for updates and system maintenance.

VIBs can be broken down into three components:

* VIB payload: a `.vgz` archive containing the directories and files to be created and executed on boot when the VIBs are loaded. 
* Signature file: verifies the host acceptance level of a VIB, indicating what testing and validation has been done by VMware or its partners before publication of a VIB. By default, ESXi hosts require a minimum acceptance level of PartnerSupported for VIB installation, meaning the VIB is published by a trusted VMware partner. However, privileged users can change the default acceptance level using the `esxcli` command line interface. Additionally, VIBs are able to be installed regardless of acceptance level by using the <code> esxcli software vib install --force</code> command. 
* XML descriptor file: a configuration file containing associated VIB metadata, such as the name of the VIB and its dependencies. 

Adversaries may leverage malicious VIB packages to maintain persistent access to ESXi hypervisors, allowing system changes to be executed upon each bootup of ESXi – such as using `esxcli` to enable firewall rules for backdoor traffic, creating listeners on hard coded ports, and executing backdoors. Adversaries may also masquerade their malicious VIB files as PartnerSupported by modifying the XML descriptor file.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** ESXi

## What to Check

- [ ] Identify if vSphere Installation Bundles technique is applicable to target environment
- [ ] Check ESXi systems for indicators of vSphere Installation Bundles
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to vSphere Installation Bundles by examining the target platforms (ESXi).

2. **Assess Existing Defenses**: Review whether mitigations for T1505.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1046 Boot Integrity
Enabling secure boot allows ESXi to validate software and drivers during initial system boot.

### M1045 Code Signing
Enabling the `execInstalledOnly` feature prevents unsigned binaries from being run on ESXi hosts.

### M1047 Audit
Periodically audit ESXi hosts to ensure that only approved VIBs are installed. The command `esxcli software vib list` lists installed VIBs, while the command `esxcli software vib signature verify` verifies the signatures of installed VIBs.


## Detection

### Detect Abuse of vSphere Installation Bundles (VIBs) for Persistent Access


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| vSphere Installation Bundles technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Google Cloud Threat Intelligence ESXi VIBs 2022](https://cloud.google.com/blog/topics/threat-intelligence/esxi-hypervisors-malware-persistence)
- [VMware VIBs](https://blogs.vmware.com/vsphere/2011/09/whats-in-a-vib.html)
- [Atomic Red Team - T1505.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1505.006)
- [MITRE ATT&CK - T1505.006](https://attack.mitre.org/techniques/T1505/006)
