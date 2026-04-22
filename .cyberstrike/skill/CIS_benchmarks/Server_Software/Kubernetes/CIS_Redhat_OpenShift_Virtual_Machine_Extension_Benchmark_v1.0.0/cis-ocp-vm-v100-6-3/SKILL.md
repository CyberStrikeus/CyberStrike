---
name: cis-ocp-vm-v100-6-3
description: "Ensure all CPU vulnerabilities are mitigated (Manual)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, openshift-virtualization, kubevirt, vm, host-kernel]
cis_id: "6.3"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 6.3 — Ensure all CPU vulnerabilities are mitigated

## Profile Applicability
- Level 1

## Description
Ensure that all known CPU vulnerabilities are mitigated. This ensures that known attacks, such as Spectre, Meltdown, etc. either do not affect the node or are mitigated via software.

## Rationale
Vulnerability mitigation ensures that known attacks cannot be exploited.

## Impact
Impact analysis should be performed on a per-mitigation basis.

## Audit Procedure
View CPU mitigations:

```
$ ls /sys/devices/system/cpu/vulnerabilities
```

Output may resemble the following:

```
"Not affected"    CPU is not affected by the vulnerability
"Vulnerable"      CPU is affected and no mitigation in effect
"Mitigation: $M"  CPU is affected and mitigation $M is in effect
```

## Remediation
Add the appropriate kernel arguments to the MachineConfigPools of the workers nodes and reboot them. See Documentation Chapter 1.Customizing nodes | Red Hat Product Documentation

## Default Value
The cpu vulnerabilities file is not populated by default

## References
None listed in the PDF.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 7.4 Perform Automated Application Patch Management | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Privilege Escalation | T1068 - Exploitation for Privilege Escalation |
| Credential Access | T1212 - Exploitation for Credential Access |

## Profile
- Level 1 - OpenShift Virtualization
