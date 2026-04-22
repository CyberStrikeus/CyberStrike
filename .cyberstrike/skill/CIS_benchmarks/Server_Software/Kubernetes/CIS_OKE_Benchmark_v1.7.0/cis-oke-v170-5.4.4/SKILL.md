---
name: cis-oke-v170-5.4.4
description: "Ensure Network Policy is Enabled and set as appropriate (Automated)"
category: cis-oke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, managed-services, cluster-networking]
cis_id: "5.4.4"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.7.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.7.0 - Control 5.4.4

## Profile Applicability

- **Level:** 1

## Description

Use Network Policy to restrict pod to pod traffic within a cluster and segregate workloads.

## Rationale

By default, all pod to pod traffic within a cluster is allowed. Network Policy creates a pod-level firewall that can be used to restrict traffic between sources. Pod traffic is restricted by having a Network Policy that selects it (through the use of labels). Once there is any Network Policy in a namespace selecting a particular pod, that pod will reject any connections that are not allowed by any Network Policy. Other pods in the namespace that are not selected by any Network Policy will continue to accept all traffic.

Network Policies are managed via the Kubernetes Network Policy API and enforced by a network plugin, simply creating the resource without a compatible network plugin to implement it will have no effect. OKE supports Network Policy enforcement through the use of Calico.

## Impact

Network Policy requires the Network Policy add-on. This add-on is included automatically when a cluster with Network Policy is created, but for an existing cluster, needs to be added prior to enabling Network Policy.

Enabling/Disabling Network Policy causes a rolling update of all cluster nodes, similar to performing a cluster upgrade. This operation is long-running and will block other operations on the cluster (including delete) until it has run to completion.

If Network Policy is used, a cluster must have at least 2 nodes of type `n1-standard-1` or higher. The recommended minimum size cluster to run Network Policy enforcement is 3 `n1-standard-1` instances.

Enabling Network Policy enforcement consumes additional resources in nodes. Specifically, it increases the memory footprint of the `kube-system` process by approximately 128MB, and requires approximately 300 millicores of CPU.

## Audit Procedure

Check for the following:

```bash
export OKE_CLUSTERID=<oke cluster id>
oci ce cluster get --cluster-id $OKE_CLUSTERID
```

Check settings for Network Policy is enabled set correctly for the cluster:

```json
"kubernetesNetworkConfig": {
    "podsCidr": "10.244.0.0/16",
    "servicesCidr": "10.96.0.0/12",
    "networkPolicyConfig": {
        "isEnabled": true
    }
}
```

## Remediation

Configure Network Policy for the Cluster.

## Default Value

By default, Network Policy is disabled.

## References

1. https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers                     | \*   | \*   | \*   |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running |      | \*   | \*   |
| v7               | 9.4 Apply Host-based Firewalls or Port Filtering                   | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations  |
| --------------------------- | ------- | ------------ |
| T1046                       | TA0007  | M1030, M1042 |

## Profile

**Level 1** (Automated)
