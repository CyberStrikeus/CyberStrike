# CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0 - Skills

This directory contains **46 SKILL.md files** for the CIS OKE Benchmark v1.8.0.

## Overview

- **Benchmark Version**: 1.8.0
- **Release Date**: 11-25-2025
- **Total Controls**: 46
- **Profile Levels**: Level 1 and Level 2
- **Platform**: Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE)
- **Validated Against**: Kubernetes v1.33, v1.34

## Control Breakdown by Section

| Section | Title                                    | Controls        |
| ------- | ---------------------------------------- | --------------- |
| 1       | Control Plane Components                 | 0 (OKE managed) |
| 2.1     | Authentication and Authorization         | 1               |
| 2.2     | Logging                                  | 1               |
| 3.1     | Worker Node Configuration Files          | 4               |
| 3.2     | Kubelet                                  | 10              |
| 4.1     | RBAC and Service Accounts                | 6               |
| 4.2     | Pod Security Policies                    | 5               |
| 4.3     | CNI Plugin                               | 2               |
| 4.4     | Secrets Management                       | 2               |
| 4.5     | General Policies                         | 3               |
| 5.1     | Image Registry and Image Scanning        | 4               |
| 5.2     | Identity and Access Management (IAM)     | 1               |
| 5.3     | Cloud Key Management Service (Cloud KMS) | 1               |
| 5.4     | Cluster Networking                       | 5               |
| 5.5     | Authentication and Authorization         | 1               |

## Section Summary

| Major Section | Title                       | Total  |
| ------------- | --------------------------- | ------ |
| 1             | Control Plane Components    | 0      |
| 2             | Control Plane Configuration | 2      |
| 3             | Worker Nodes                | 14     |
| 4             | Policies                    | 18     |
| 5             | Managed Services            | 12     |
| **Total**     |                             | **46** |

**Note:** Section 1 (Control Plane Components) has no auditable sub-controls as OKE manages these components.

## Directory Structure

```
cis-oke-v180-{control_id}/
└── SKILL.md
```

## Source Document

**CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0**

- Platform: Oracle Cloud Infrastructure OKE
- Original PDF: `CIS_Oracle_Cloud_Infrastructure_Container_Engine_for_Kubernetes(OKE)_Benchmark_v1.8.0_PDF.pdf`

## Contact

- CyberStrike: cyberstrike.io
- CIS Benchmarks: cisecurity.org
