---
name: cis-oke-v170-2.2.1
description: "Ensure access to OCI Audit service Log for OKE (Manual)"
category: cis-oke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, control-plane-config, logging]
cis_id: "2.2.1"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.7.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.7.0 - Control 2.2.1

## Profile Applicability

- **Level:** 1

## Description

The audit logs are part of the OKE managed Kubernetes control plane logs managed by OKE. OKE integrates with Oracle Cloud Infrastructure Audit Service.

All operations performed by the Kubernetes API server are visible as log events on the Oracle Cloud Infrastructure Audit service.

## Rationale

Logging is a crucial detective control for all systems to detect potential unauthorized access.

## Impact

The Control plane audit logs are managed by OKE. OKE Control plane logs are written to the Oracle Cloud Infrastructure Audit Service. The Oracle Cloud Infrastructure Audit service automatically records calls to all supported Oracle Cloud Infrastructure public application programming interface (API) endpoints as log events.

## Audit Procedure

### Using Oracle Cloud Infrastructure Console

To monitor and manage operations performed by Container Engine for Kubernetes on a particular cluster:

1. In the Console, open the navigation menu. Under **Solutions and Platform**, go to **Developer Services** and click **Kubernetes Clusters**.
2. Choose a **Compartment** you have permission to work in.
3. On the **Cluster List** page, click the cluster's name for which you want to monitor and manage operations.
4. The **Cluster** page shows information about the cluster.
5. Display the **Work Requests** tab, showing the recent operations performed on the cluster.

To view operations performed by Container Engine for Kubernetes and the Kubernetes API server as log events in the Oracle Cloud Infrastructure Audit service:

1. In the Console, open the navigation menu. Under **Governance and Administration**, go to **Governance** and click **Audit**.
2. Choose a **Compartment** you have permission to work in.
3. Search and filter to show the operations you're interested in:

- To view operations performed by Container Engine for Kubernetes, enter `ClustersAPI` in the **Keywords** field and click **Search**.
- To view operations performed by the Kubernetes API server, enter `OKE API Server Admin Access` in the **Keywords** field and click **Search**.

## Remediation

No remediation is necessary for this control.

## Default Value

By default, Kubernetes API server logs and Container Engine for Kubernetes audit events are sent to the Oracle Cloud Infrastructure Audit service. By default, the Audit Log retention period is 90 days.

## References

1. https://kubernetes.io/docs/tasks/debug-application-cluster/audit/
2. https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Tasks/contengmonitoringoke.htm
3. https://docs.cloud.oracle.com/en-us/iaas/Content/Audit/Tasks/viewinglogevents.htm#Viewing_Audit_Log_Events
4. https://docs.cloud.oracle.com/en-us/iaas/Content/Audit/Tasks/settingretentionperiod.htm

## CIS Controls

| Controls Version | Control                    | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs     | \*   | \*   | \*   |
| v7               | 6.2 Activate audit logging | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1543                       | TA0003, TA0004 | M1026       |

## Profile

**Level 1** (Manual)
