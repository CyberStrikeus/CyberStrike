# CIS Kubernetes Benchmark v2.0.0 - Skills

This directory contains **131 SKILL.md files** for the CIS Kubernetes Benchmark v2.0.0.

## Overview

- **Benchmark Version**: 2.0.0
- **Release Date**: 03-31-2026
- **Total Controls**: 131
- **Profile Levels**: Level 1 and Level 2 (Master Node / Worker Node)
- **Platform**: Vanilla/Generic Kubernetes (cloud-agnostic)
- **Validated Against**: Kubernetes v1.35

## Control Breakdown by Section

| Section | Title | Controls |
|---------|-------|----------|
| 1.1 | Control Plane Node Configuration Files | 21 |
| 1.2 | API Server | 30 |
| 1.3 | Controller Manager | 7 |
| 1.4 | Scheduler | 2 |
| 2 | etcd Node Configuration | 7 |
| 3.1 | Authentication and Authorization | 3 |
| 3.2 | Logging | 2 |
| 4.1 | Worker Node Configuration Files | 10 |
| 4.2 | Kubelet | 14 |
| 4.3 | kube-proxy | 1 |
| 5.1 | RBAC and Service Accounts | 13 |
| 5.2 | Pod Security Standards | 12 |
| 5.3 | Network Policies and CNI | 2 |
| 5.4 | Secrets Management | 2 |
| 5.5 | Extensible Admission Control | 1 |
| 5.6 | General Policies | 4 |

## Section Summary

| Major Section | Title | Total |
|---------------|-------|-------|
| 1 | Control Plane Components | 60 |
| 2 | etcd Node Configuration | 7 |
| 3 | Control Plane Configuration | 5 |
| 4 | Worker Nodes | 25 |
| 5 | Policies | 34 |
| **Total** | | **131** |

## Changes from v1.12.0

- Major version bump: validated against Kubernetes v1.35 (was v1.34)
- Updated all recommendations and audits to comply with Kubernetes v1.35
- Edited recommendation 5.1.5 (Ticket #27307)
- Updated recommendation 4.2.12 cipher suite to match audit
- Removed insecure ciphers from remediation process (Ticket #26517)
- Controls 1.1.13/1.1.14 reference `super-admin.conf` (Kubernetes 1.29+)

## Directory Structure

```
cis-k8s-v200-{control_id}/
└── SKILL.md
```

## Source Document

**CIS Kubernetes Benchmark v2.0.0**
- Platform: Generic/Vanilla Kubernetes (cloud-agnostic)
- Original PDF: `CIS_Kubernetes_Benchmark_V2.0.0_PDF.pdf`

## Contact

- CyberStrike: cyberstrike.io
- CIS Benchmarks: cisecurity.org
