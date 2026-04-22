# CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0 - Skills

This directory contains **26 SKILL.md files** for the CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0.

## Overview

- **Benchmark Version**: 1.0.0
- **Release Date**: 10-30-2025
- **Total Controls**: 26
- **Profile Levels**: Level 1 and Level 2
- **Platform**: Red Hat OpenShift Virtualization (OCPvirt) / KubeVirt
- **Target Technology**: OpenShift Virtualization on OpenShift Container Platform 4.x

## Control Breakdown by Section

| Section   | Title                         | Controls |
| --------- | ----------------------------- | -------- |
| 1         | Platform Configuration        | 14       |
| 2         | Virtual Machine Configuration | 2        |
| 3         | Storage Components            | 3        |
| 4         | Networking Components         | 3        |
| 5         | Host Firmware (KVM options)   | 1        |
| 6         | Host Kernel                   | 3        |
| **Total** |                               | **26**   |

## Scope

This is an **extension benchmark** that augments the CIS Red Hat OpenShift Container Platform Benchmark with controls specific to **OpenShift Virtualization (OCPvirt)** — the OpenShift platform for running Virtual Machines using KubeVirt. It covers:

- **Platform Configuration**: Feature gates, seccomp profiles, KSM, migration tools, VNC access, CDI
- **Virtual Machine Configuration**: GPU/host device passthrough, memory overcommit
- **Storage Components**: DataVolume cloning, shareable disks, errorPolicy
- **Networking Components**: VLAN segmentation, MAC spoof filtering, multi-network policies
- **Host Firmware**: Intel TXT configuration for KVM hosts
- **Host Kernel**: Nested virtualization, vCPU metrics, CPU vulnerability mitigations

## OpenShift Virtualization-Specific Features

- Uses **HyperConverged** custom resource to configure OCPvirt cluster
- Uses **KubeVirt** as the underlying VM engine
- Uses **Containerized Data Importer (CDI)** for VM disk management
- Audit commands use `oc` CLI (OpenShift-specific) with KubeVirt/HyperConverged CRDs
- Integration with OpenShift SCCs for VM workload security

## Directory Structure

```
cis-ocp-vm-v100-{control_id}/
└── SKILL.md
```

Example: `cis-ocp-vm-v100-1-1/SKILL.md` for control 1.1

## Source Document

**CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0**

- Platform: Red Hat OpenShift Virtualization (OCPvirt) / KubeVirt
- Original PDF: `CIS_Redhat_OpenShift_Virtual_Machine_Extension_Benchmark_V1.0.0_PDF.pdf`

## Contact

- CyberStrike: cyberstrike.io
- CIS Benchmarks: cisecurity.org
