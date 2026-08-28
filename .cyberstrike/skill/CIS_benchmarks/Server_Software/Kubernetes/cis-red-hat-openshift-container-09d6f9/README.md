# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Skills

This directory contains **118 SKILL.md files** for the CIS Red Hat OpenShift Container Platform Benchmark v1.7.0.

## Overview

- **Benchmark Version**: 1.7.0
- **Release Date**: 12-23-2024
- **Total Controls**: 118
- **Profile Levels**: Level 1 and Level 2
- **Platform**: Red Hat OpenShift Container Platform 4
- **Target Technology**: OpenShift Container Platform 4.x

## Control Breakdown by Section

| Section | Title                            | Controls |
| ------- | -------------------------------- | -------- |
| 1.1     | Master Node Configuration Files  | 21       |
| 1.2     | API Server                       | 33       |
| 1.3     | Controller Manager               | 5        |
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
| 1             | Control Plane Components    | 61      |
| 2             | etcd                        | 7       |
| 3             | Control Plane Configuration | 3       |
| 4             | Worker Nodes                | 22      |
| 5             | Policies                    | 25      |
| **Total**     |                             | **118** |

**Note:** Section 5.6 does not exist in this benchmark. General Policies is numbered 5.7.

## Changes to v1.8.0

- Removed 1.2.2 (--basic-auth-file) and 1.2.3 (--token-auth-file), renumbered S1.2 (33 → 31)
- Removed 1.3.5 (--bind-address 127.0.0.1), S1.3 reduced from 5 → 4
- Net change: 118 → 115 controls

## OpenShift-Specific Features

- Uses **Security Context Constraints (SCC)** instead of Pod Security Policies (Section 5.2)
- Audit commands use `oc` CLI tool (OpenShift-specific) instead of `kubectl`
- Uses `oc debug node/` for worker node inspection
- Admission control includes **SecurityContextConstraint** plugin (1.2.14)
- Image provenance configured via OpenShift image controller (5.5.1)

## Directory Structure

```
cis-ocp-v170-{control_id}/
└── SKILL.md
```

## Source Document

**CIS Red Hat OpenShift Container Platform Benchmark v1.7.0**

- Platform: Red Hat OpenShift Container Platform 4
- Original PDF: `CIS Red Hat Openshift Container Platform V1.7.0 PDF.pdf`

## Contact

- CyberStrike: cyberstrike.io
- CIS Benchmarks: cisecurity.org
