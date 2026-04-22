# CIS Google Kubernetes Engine (GKE) Benchmark v1.8.0 - Skills

This directory contains **57 SKILL.md files** for the CIS Google Kubernetes Engine (GKE) Benchmark v1.8.0.

## Overview

- **Benchmark Version**: 1.8.0
- **Total Controls**: 57
- **Profile Levels**: Level 1 and Level 2
- **Platform**: Google Cloud GKE (Standard)

## Control Breakdown by Section

| Section | Title                                    | Controls |
| ------- | ---------------------------------------- | -------- |
| 3.1     | Worker Node Configuration Files          | 4        |
| 4.1     | RBAC and Service Accounts                | 10       |
| 4.2     | Pod Security Standards                   | 1        |
| 4.3     | Network Policies and CNI                 | 2        |
| 4.4     | Secrets Management                       | 2        |
| 4.5     | Extensible Admission Control             | 1        |
| 4.6     | General Policies                         | 4        |
| 5.1     | Image Registry and Image Scanning        | 4        |
| 5.2     | Identity and Access Management (IAM)     | 2        |
| 5.3     | Cloud Key Management Service (Cloud KMS) | 1        |
| 5.4     | Node Metadata                            | 1        |
| 5.5     | Node Configuration and Maintenance       | 7        |
| 5.6     | Cluster Networking                       | 7        |
| 5.7     | Logging                                  | 2        |
| 5.8     | Authentication and Authorization         | 3        |
| 5.9     | Storage                                  | 2        |
| 5.10    | Other Cluster Configurations             | 4        |

**Note:** Sections 1 (Control Plane Components) and 2 (Control Plane Configuration) have no auditable sub-controls as GKE manages these components. Section 3.2 (Kubelet) was removed in this version.

## Changes from v1.7.0

- Removed Section 3.2 Kubelet (9 controls)
- Removed 5.10.4 Binary Authorization (merged elsewhere)
- 5.10.5 Security Posture renumbered to 5.10.4

## Directory Structure

```
cis-gke-v180-{control_id}/
└── SKILL.md
```

## Source Document

**CIS Google Kubernetes Engine (GKE) Benchmark v1.8.0**

- Platform: Google Cloud GKE (Standard)
- Original PDF: `CIS_Google_Kubernetes_Engine_(GKE)_Benchmark_v1.8.0_PDF.pdf`

## Contact

- CyberStrike: cyberstrike.io
- CIS Benchmarks: cisecurity.org
