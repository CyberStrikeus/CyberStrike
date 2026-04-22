---
name: cis-eks-v160-5.4.4
description: "Ensure Network Policy is Enabled and set as appropriate (Automated)"
category: cis-eks
version: "1.6.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, networking, network-policy, calico, vpc-cni]
cis_id: "5.4.4"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.6.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.4 Ensure Network Policy is Enabled and set as appropriate (Automated)

## Profile Applicability

- Level 1

## Description

Amazon EKS provides two ways to implement network policy. You choose a network policy option when you create an EKS cluster. The policy option can't be changed after the cluster is created: Calico Network Policies, an open-source network and network security solution founded by Tigera. Both implementations use Linux IPTables to enforce the specified policies. Policies are translated into sets of allowed and disallowed IP pairs. These pairs are then programmed as IPTable filter rules.

## Rationale

By default, all pod to pod traffic within a cluster is allowed. Network Policy creates a pod-level firewall that can be used to restrict traffic between sources. Pod traffic is restricted by having a Network Policy that selects it (through the use of labels). Once there is any Network Policy in a namespace selecting a particular pod, that pod will reject any connections that are not allowed by any Network Policy. Other pods in the namespace that are not selected by any Network Policy will continue to accept all traffic.

Network Policies are managed via the Kubernetes Network Policy API and enforced by a network plugin, simply creating the resource without a compatible network plugin to implement it will have no effect.

## Impact

Network Policy requires the Network Policy add-on. This add-on is included automatically when a cluster with Network Policy is created, but for an existing cluster, needs to be added prior to enabling Network Policy.

Enabling/Disabling Network Policy causes a rolling update of all cluster nodes, similar to performing a cluster upgrade. This operation is long-running and will block other operations on the cluster (including delete) until it has run to completion.

Enabling Network Policy enforcement consumes additional resources in nodes. Specifically, it increases the memory footprint of the kube-system process by approximately 128MB, and requires approximately 300 millicores of CPU.

## Audit Procedure

Check for the following is not null and set with appropriate group id:

```bash
export CLUSTER_NAME=<your cluster name>

aws eks describe-cluster --name ${CLUSTER_NAME} --query "cluster.resourcesVpcConfig.clusterSecurityGroupId"
```

Check for the following is True:

```bash
export CLUSTER_NAME=<your cluster name>

aws eks describe-addon --cluster-name ${CLUSTER_NAME} --addon-name vpc-cni --query addon.configurationValues
```

## Remediation

Utilize Calico or other network policy engine to segment and isolate your traffic.

## Default Value

By default, Network Policy is disabled.

## References

1. https://docs.aws.amazon.com/eks/latest/userguide/eks-networking-add-ons.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 12.6 Use of Secure Network Management and Communication Protocols | | X | X |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | X | X |
| v7 | 9.4 Apply Host-based Firewalls or Port Filtering | X | X | X |
