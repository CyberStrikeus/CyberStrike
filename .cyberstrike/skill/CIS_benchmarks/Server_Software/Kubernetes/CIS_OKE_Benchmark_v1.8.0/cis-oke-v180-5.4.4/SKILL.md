---
name: cis-oke-v180-5.4.4
description: "Ensure Network Policy is Enabled and set as appropriate (Manual)"
category: cis-oke
version: "1.8.0"
author: cyberstrike-official
tags:
  [cis, oke, kubernetes, oci, managed-services, cluster-networking, network-policy, calico, pod-isolation, segmentation]
cis_id: "5.4.4"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.4 Ensure Network Policy is Enabled and set as appropriate (Manual)

## Profile Applicability

- Level 1

## Description

Implementing Kubernetes Network Policies in an Oracle Kubernetes Engine (OKE) cluster is a critical security measure for controlling and segregating pod-to-pod communication. By default, all pods in a Kubernetes cluster can freely communicate with each other, which increases the risk of lateral movement if a single workload is compromised. Enforcing network policies allows administrators to explicitly define which pods or namespaces can communicate, ensuring that workloads are properly isolated based on function, sensitivity, or compliance requirements. This segregation helps contain potential security breaches, limits unauthorized data access between applications, and supports the principle of least privilege in network communication -- strengthening the overall security posture and reducing the attack surface within the OKE environment.

Configure a Network Policy to restrict pod-to-pod traffic within a cluster and segregate workloads.

## Rationale

By default, all pod to pod traffic within a cluster is allowed. Network Policy creates a pod-level firewall that can be used to restrict traffic between sources. Pod traffic is restricted by having a Network Policy that selects it (through the use of labels). Once there is any Network Policy in a namespace selecting a particular pod, that pod will reject any connections that are not allowed by any Network Policy. Other pods in the namespace that are not selected by any Network Policy will continue to accept all traffic.

Network Policies are managed via the Kubernetes Network Policy API and enforced by a network plugin, simply creating the resource without a compatible network plugin to implement it will have no effect. OKE supports Network Policy enforcement through the use of Calico.

## Impact

Network Policy requires the Network Policy add-on. This add-on is included automatically when a cluster with Network Policy is created, but for an existing cluster, needs to be added prior to enabling Network Policy.

Enabling/Disabling Network Policy causes a rolling update of all cluster nodes, similar to performing a cluster upgrade. This operation is long-running and will block other operations on the cluster (including delete) until it has run to completion.

If Network Policy is used, a cluster must have at least 2 nodes of type `n1-standard-1` or higher. The recommended minimum size cluster to run Network Policy enforcement is 3 `n1-standard-1` instances.

Enabling Network Policy enforcement consumes additional resources in nodes. Specifically, it increases the memory footprint of the `kube-system` process by approximately 128MB, and requires approximately 300 millicores of CPU.

## Audit

Below is a command line statement to check whether Network Policies are configured in your Oracle Kubernetes Engine (OKE) cluster:

```bash
echo -e "NAMESPACE\tNETWORK_POLICY_COUNT" && \
for ns in $(kubectl get ns -o jsonpath='{.items[*].metadata.name}'); do
  count=$(kubectl get networkpolicy -n "$ns" --no-headers 2>/dev/null | wc -l \
  | tr -d ' ')
  echo -e "${ns}\t${count}"
done
```

Sample Output:

```
NAMESPACE           NETWORK_POLICY_COUNT
default             2
kube-node-lease     3
kube-public         5
kube-system         0
```

- A count of 0 means no NetworkPolicy objects exist in that namespace and pod-to-pod communication is unrestricted.
- A count greater than 0 means network policies are defined and applied, helping isolate and protect workloads.

## Remediation

When creating a new OKE cluster enable network policies by setting the following flag:

**For a New OKE Cluster enable Network Policy on Cluster Creation:**

```bash
oci ce cluster create \
  --compartment-id "${COMPARTMENT_ID}" \
  --name "secure-cluster" \
  --vcn-id "${VCN_OCID}" \
  --kubernetes-version "v1.30.1" \
  --is-kubernetes-dashboard-enabled false \
  --options '{"serviceLbSubnetIds":["<subnet_ocid>"], "isNetworkPolicyEnabled": true}'
```

**For an Existing OKE Cluster, enable Network Policy on the Existing Cluster:**

```bash
oci ce cluster update \
  --cluster-id "${CLUSTER_ID}" \
  --options '{"isNetworkPolicyEnabled": true}' \
  --force
```

- Apply a Default Deny-All Policy
- Add Fine-Grained Policies for Authorized Communication by defining NetworkPolicy manifests that explicitly allow required traffic between trusted workloads, services, or namespaces.
- Define Namespace-Level Network Policies after cluster creation, apply a restrictive default policy to each namespace
- Add Allow Rules for Required Traffic and create specific NetworkPolicy resources to allow communication only between approved pods or namespaces.

## Default Value

By default, Network Policy is disabled.

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers                     | x    | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running |      | x    | x    |
| v7               | 9.4 Apply Host-based Firewalls or Port Filtering                   | x    | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations  |
| --------------------------- | ------- | ------------ |
| T1046                       | TA0007  | M1030, M1042 |
