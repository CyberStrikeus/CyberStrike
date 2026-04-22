---
name: cis-aks-v180-5.4.4
description: "Ensure Network Policy is Enabled and set as appropriate (Automated)"
category: cis-aks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, networking, network-policy, calico, segmentation]
cis_id: "5.4.4"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.4 Ensure Network Policy is Enabled and set as appropriate (Automated)

## Profile Applicability

- Level 1

## Description

When you run modern, microservices-based applications in Kubernetes, you often want to control which components can communicate with each other. The principle of least privilege should be applied to how traffic can flow between pods in an Azure Kubernetes Service (AKS) cluster. Let's say you likely want to block traffic directly to back-end applications. The Network Policy feature in Kubernetes lets you define rules for ingress and egress traffic between pods in a cluster.

## Rationale

All pods in an AKS cluster can send and receive traffic without limitations, by default. To improve security, you can define rules that control the flow of traffic. Back-end applications are often only exposed to required front-end services, for example. Or, database components are only accessible to the application tiers that connect to them.

Network Policy is a Kubernetes specification that defines access policies for communication between Pods. Using Network Policies, you define an ordered set of rules to send and receive traffic and apply them to a collection of pods that match one or more label selectors.

These network policy rules are defined as YAML manifests. Network policies can be included as part of a wider manifest that also creates a deployment or service.

## Impact

Network Policy requires the Network Policy add-on. This add-on is included automatically when a cluster with Network Policy is created, but for an existing cluster, needs to be added prior to enabling Network Policy.

Enabling/Disabling Network Policy causes a rolling update of all cluster nodes, similar to performing a cluster upgrade. This operation is long-running and will block other operations on the cluster (including delete) until it has run to completion.

If Network Policy is used, a cluster must have at least 2 nodes of type `n1-standard-1` or higher. The recommended minimum size cluster to run Network Policy enforcement is 3 `n1-standard-1` instances.

Enabling Network Policy enforcement consumes additional resources in nodes. Specifically, it increases the memory footprint of the `kube-system` process by approximately 128MB, and requires approximately 300 millicores of CPU.

## Audit

Check for the following is not null and set with appropriate group id:

```bash
export CLUSTER_NAME=<your cluster name>
az aks show --name ${CLUSTER_NAME} --resource-group ${RESOURCE_GROUP} --query "networkProfile.networkPolicy"
```

## Remediation

Utilize Calico or other network policy engine to segment and isolate your traffic.

## Default Value

By default, Network Policy is disabled.

## References

1. https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-network-security#ns-2-connect-private-networks-together
2. https://docs.microsoft.com/en-us/azure/aks/use-network-policies

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.4 Implement and Manage a Firewall on Servers | x | x | x |
| v8 | 4.5 Implement and Manage a Firewall on End-User Devices | x | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |
| v7 | 9.4 Apply Host-based Firewalls or Port Filtering | x | x | x |
