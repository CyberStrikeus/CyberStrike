# CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.6.0 - Skills

This directory contains **46 SKILL.md files** for the CIS Amazon EKS Benchmark v1.6.0.

## Overview

- **Benchmark Version**: 1.6.0
- **Release Date**: 12-23-2024
- **Total Controls**: 46
- **Profile Levels**: Level 1 and Level 2

## Control Breakdown by Section

| Section | Title                                | Controls |
| ------- | ------------------------------------ | -------- |
| 2.1     | Logging                              | 2        |
| 3.1     | Worker Node Configuration Files      | 4        |
| 3.2     | Kubelet                              | 9        |
| 4.1     | RBAC and Service Accounts            | 8        |
| 4.2     | Pod Security Standards               | 5        |
| 4.3     | CNI Plugin                           | 2        |
| 4.4     | Secrets Management                   | 2        |
| 4.5     | General Policies                     | 2        |
| 5.1     | Image Registry and Image Scanning    | 4        |
| 5.2     | Identity and Access Management (IAM) | 1        |
| 5.3     | AWS EKS Key Management Service       | 1        |
| 5.4     | Cluster Networking                   | 5        |
| 5.5     | Authentication and Authorization     | 1        |

## Notes

- Section 1 (Control Plane Components) has no auditable controls — EKS manages the control plane
- Section 2 covers EKS-specific control plane configuration (audit logging)
- Section 3 covers worker node hardening (kubelet configuration)
- Section 4 covers Kubernetes policies (RBAC, pod security, networking, secrets)
- Section 5 covers AWS managed services integration (ECR, IAM, KMS, VPC)

## Directory Structure

```
cis-eks-v160-{control_id}/
└── SKILL.md
```

## Source Document

**CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.6.0**

- Platform: AWS EKS
- Original PDF: `CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.6.0.pdf`

## Contact

- CyberStrike: cyberstrike.io
- CIS Benchmarks: cisecurity.org
