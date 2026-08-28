# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Skills

This directory contains **118 SKILL.md files** for the CIS Red Hat OpenShift Container Platform Benchmark v1.6.0.

## Overview

- **Benchmark Version**: 1.6.0
- **Release Date**: 06-21-2024
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

## Changes to v1.7.0

- Same control structure and count (118 controls)
- v1.6.0 and v1.7.0 both include 1.2.2 (--basic-auth-file), 1.2.3 (--token-auth-file), and 1.3.5 (--bind-address)
- These 3 controls were removed in v1.8.0, reducing the count to 115

## v1.6.0-Specific Notes

- Control 1.1.12: etcd data directory ownership is `etcd:etcd` (changed to `root:root` in later versions)
- Control 1.2.2: `--basic-auth-file` argument check (removed in v1.8.0)
- Control 1.2.3: `--token-auth-file` parameter check (removed in v1.8.0)
- Control 1.3.5: `--bind-address` set to 127.0.0.1 (removed in v1.8.0)

## OpenShift-Specific Features

- Uses **Security Context Constraints (SCC)** instead of Pod Security Policies (Section 5.2)
- Audit commands use `oc` CLI tool (OpenShift-specific) instead of `kubectl`
- Uses `oc debug node/` for worker node inspection
- Admission control includes **SecurityContextConstraint** plugin (1.2.14)
- Image provenance configured via OpenShift image controller (5.5.1)

## Directory Structure

```
cis-ocp-v160-{control_id}/
└── SKILL.md
```

## Source Document

**CIS Red Hat OpenShift Container Platform Benchmark v1.6.0**

- Platform: Red Hat OpenShift Container Platform 4
- Original PDF: `CIS Red Hat OpenShift Container Platform Benchmark V1.6.0 PDF.pdf`

## Contact

- CyberStrike: cyberstrike.io
- CIS Benchmarks: cisecurity.org
