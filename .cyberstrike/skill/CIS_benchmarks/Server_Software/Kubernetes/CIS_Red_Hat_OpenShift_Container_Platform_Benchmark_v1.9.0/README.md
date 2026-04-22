# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Skills

This directory contains **115 SKILL.md files** for the CIS Red Hat OpenShift Container Platform Benchmark v1.9.0.

## Overview

- **Benchmark Version**: 1.9.0
- **Release Date**: 12-11-2025
- **Total Controls**: 115
- **Profile Levels**: Level 1 and Level 2
- **Platform**: Red Hat OpenShift Container Platform 4
- **Target Technology**: OpenShift Container Platform 4.x

## Control Breakdown by Section

| Section | Title                            | Controls |
| ------- | -------------------------------- | -------- |
| 1.1     | Master Node Configuration Files  | 21       |
| 1.2     | API Server                       | 31       |
| 1.3     | Controller Manager               | 4        |
| 1.4     | Scheduler                        | 2        |
| 2       | etcd                             | 7        |
| 3.1     | Authentication and Authorization | 1        |
| 3.2     | Logging                          | 2        |
| 4.1     | Worker Node Configuration Files  | 10       |
| 4.2     | Kubelet                          | 12       |
| 5.1     | RBAC and Service Accounts        | 6        |
| 5.2     | Security Context Constraints     | 10       |
| 5.3     | Network Policies and CNI         | 2        |
| 5.4     | Secrets Management               | 2        |
| 5.5     | Extensible Admission Control     | 1        |
| 5.7     | General Policies                 | 4        |

## Section Summary

| Major Section | Title                       | Total   |
| ------------- | --------------------------- | ------- |
| 1             | Control Plane Components    | 58      |
| 2             | etcd                        | 7       |
| 3             | Control Plane Configuration | 3       |
| 4             | Worker Nodes                | 22      |
| 5             | Policies                    | 25      |
| **Total**     |                             | **115** |

**Note:** Section 5.6 does not exist in this benchmark. General Policies is numbered 5.7.

## Changes from v1.8.0

- Same control structure and count (115 controls)
- Updated audit procedures for OpenShift 4.14+
- Default values updated (e.g., kube-apiserver-pod.yaml permissions now 600 in OCP 4.14)

## OpenShift-Specific Features

- Uses **Security Context Constraints (SCC)** instead of Pod Security Policies (Section 5.2)
- Audit commands use `oc` CLI tool (OpenShift-specific) instead of `kubectl`
- Uses `oc debug node/` for worker node inspection
- Admission control includes **SecurityContextConstraint** plugin (1.2.12)
- Image provenance configured via OpenShift image controller (5.5.1)

## Directory Structure

```
cis-ocp-v190-{control_id}/
└── SKILL.md
```

## Source Document

**CIS Red Hat OpenShift Container Platform Benchmark v1.9.0**

- Platform: Red Hat OpenShift Container Platform 4
- Original PDF: `CIS_Red_Hat_OpenShift_Container_Platform_Benchmark_v1.9.0_PDF.pdf`

## Contact

- CyberStrike: cyberstrike.io
- CIS Benchmarks: cisecurity.org
