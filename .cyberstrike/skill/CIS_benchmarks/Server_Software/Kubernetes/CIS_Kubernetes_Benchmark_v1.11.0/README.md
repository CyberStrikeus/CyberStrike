# CIS Kubernetes Benchmark v1.11.0 - Skills

This directory contains **134 SKILL.md files** for the CIS Kubernetes Benchmark v1.11.0.

## Overview

- **Benchmark Version**: 1.11.0
- **Release Date**: 04-01-2025
- **Total Controls**: 134
- **Profile Levels**: Level 1 and Level 2 (Master Node / Worker Node)
- **Platform**: Vanilla/Generic Kubernetes (cloud-agnostic)

## Control Breakdown by Section

| Section | Title | Controls |
|---------|-------|----------|
| 1.1 | Control Plane Node Configuration Files | 21 |
| 1.2 | API Server | 30 |
| 1.3 | Controller Manager | 7 |
| 1.4 | Scheduler | 2 |
| 2 | etcd Node Configuration | 8 |
| 3.1 | Authentication and Authorization | 3 |
| 3.2 | Logging | 2 |
| 4.1 | Worker Node Configuration Files | 10 |
| 4.2 | Kubelet | 15 |
| 4.3 | kube-proxy | 1 |
| 5.1 | RBAC and Service Accounts | 13 |
| 5.2 | Pod Security Standards | 13 |
| 5.3 | Network Policies and CNI | 2 |
| 5.4 | Secrets Management | 2 |
| 5.5 | Extensible Admission Control | 1 |
| 5.7 | General Policies | 4 |

## Section Summary

| Major Section | Title | Total |
|---------------|-------|-------|
| 1 | Control Plane Components | 60 |
| 2 | etcd Node Configuration | 8 |
| 3 | Control Plane Configuration | 5 |
| 4 | Worker Nodes | 26 |
| 5 | Policies | 35 |
| **Total** | | **134** |

## Known Issues in v1.11.0

- **Duplicate 2.2**: Control 2.2 is a duplicate of 2.1 (both "--cert-file and --key-file arguments"). This was fixed in v1.11.1 by removing the duplicate and renumbering 2.3-2.8 to 2.2-2.7.
- **Section 5.7 numbering**: General Policies is numbered 5.7 (not 5.6). Section 5.6 does not exist. This was renumbered to 5.6 in v1.11.1.

## Changes to v1.11.1

- Removed duplicate etcd recommendation 2.2 (renumbered 2.3-2.8 to 2.2-2.7, net -1 in Section 2)
- Renumbered Section 5.7 General Policies to Section 5.6
- Updated controls 8 mapping throughout

## Directory Structure

```
cis-k8s-v1110-{control_id}/
└── SKILL.md
```

## Source Document

**CIS Kubernetes Benchmark v1.11.0**
- Platform: Generic/Vanilla Kubernetes (cloud-agnostic)
- Original PDF: `CIS Kubernetes Benchmark v1.11 PDF.pdf`

## Contact

- CyberStrike: cyberstrike.io
- CIS Benchmarks: cisecurity.org
