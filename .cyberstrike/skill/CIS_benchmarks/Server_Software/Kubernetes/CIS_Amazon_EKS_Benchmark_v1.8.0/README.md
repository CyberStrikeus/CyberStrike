# CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.8.0 - Skills

This directory contains **50 SKILL.md files** for the CIS Amazon EKS Benchmark v1.8.0.

## Overview

- **Benchmark Version**: 1.8.0
- **Release Date**: 10-22-2025
- **Total Controls**: 50
- **Profile Levels**: Level 1 and Level 2

## Control Breakdown by Section

| Section | Title | Controls |
|---------|-------|----------|
| 2.1 | Logging | 2 |
| 3.1 | Worker Node Configuration Files | 4 |
| 3.2 | Kubelet | 9 |
| 4.1 | RBAC and Service Accounts | 12 |
| 4.2 | Pod Security Standards | 5 |
| 4.3 | CNI Plugin | 2 |
| 4.4 | Secrets Management | 2 |
| 4.5 | General Policies | 2 |
| 5.1 | Image Registry and Image Scanning | 4 |
| 5.2 | Identity and Access Management (IAM) | 1 |
| 5.3 | AWS EKS Key Management Service | 1 |
| 5.4 | Cluster Networking | 5 |
| 5.5 | Authentication and Authorization | 1 |

## Changes from v1.6.0

- **4 new controls**: 4.1.9 (persistent volumes), 4.1.10 (node proxy), 4.1.11 (webhooks), 4.1.12 (SA token creation)
- **13 controls changed** from Automated to Manual assessment status
- **5.4.4 renamed** to "Ensure AmazonEKSNetworkingPolicy is Enabled" (was generic Network Policy)

## Directory Structure

```
cis-eks-v180-{control_id}/
└── SKILL.md
```

## Source Document

**CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.8.0**
- Platform: AWS EKS
- Original PDF: `CIS_Amazon_Elastic_Kubernetes_Service_(EKS)_v.1.8.0_PDF.pdf`

## Contact

- CyberStrike: cyberstrike.io
- CIS Benchmarks: cisecurity.org
