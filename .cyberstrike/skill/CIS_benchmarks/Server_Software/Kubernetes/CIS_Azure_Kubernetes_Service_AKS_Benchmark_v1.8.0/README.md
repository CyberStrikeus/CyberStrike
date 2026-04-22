# CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0 - Skills

This directory contains **51 SKILL.md files** for the CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0.

## Overview

- **Benchmark Version**: 1.8.0
- **Release Date**: 10-22-2025
- **Total Controls**: 51
- **Profile Levels**: Level 1 and Level 2

## Control Breakdown by Section

| Section | Title | Controls |
|---------|-------|----------|
| 2.1 | Logging | 1 |
| 3.1 | Worker Node Configuration Files | 4 |
| 3.2 | Kubelet | 9 |
| 4.1 | RBAC and Service Accounts | 12 |
| 4.2 | Pod Security Standards | 5 |
| 4.4 | CNI Plugin | 2 |
| 4.5 | Secrets Management | 2 |
| 4.6 | General Policies | 3 |
| 5.1 | Image Registry and Image Scanning | 4 |
| 5.2 | Access and Identity Options | 1 |
| 5.3 | Key Management Service (KMS) | 1 |
| 5.4 | Cluster Networking | 5 |
| 5.5 | Authentication and Authorization | 2 |

## Key Differences from EKS

- Azure-specific: azure.json file checks (3.1.3, 3.1.4)
- 4.3 Azure Policy / OPA section (informational, no auditable controls)
- 4.6.2 Apply Security Context to Pods (AKS-specific)
- 5.1.1 Microsoft Defender for Cloud (MDC) instead of ECR
- 5.5.1 Azure AD integration, 5.5.2 Azure RBAC for K8s

## Directory Structure

```
cis-aks-v180-{control_id}/
└── SKILL.md
```

## Source Document

**CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0**
- Platform: Azure AKS
- Original PDF: `CIS_Azure_Kubernetes_Service_(AKS)_Benchmark_V1.8.0_PDF.pdf`

## Contact

- CyberStrike: cyberstrike.io
- CIS Benchmarks: cisecurity.org
