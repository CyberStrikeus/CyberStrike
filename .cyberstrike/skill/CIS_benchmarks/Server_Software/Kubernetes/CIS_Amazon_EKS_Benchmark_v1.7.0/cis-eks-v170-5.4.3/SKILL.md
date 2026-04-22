---
name: cis-eks-v170-5.4.3
description: "Ensure clusters are created with Private Nodes (Automated)"
category: cis-eks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, networking, private-nodes, private-subnets]
cis_id: "5.4.3"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.7.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.3 Ensure clusters are created with Private Nodes (Automated)

## Profile Applicability

- Level 1

## Description

Disable public IP addresses for cluster nodes, so that they only have private IP addresses. Private Nodes are nodes with no public IP addresses.

## Rationale

Disabling public IP addresses on cluster nodes restricts access to only internal networks, forcing attackers to obtain local network access before attempting to compromise the underlying Kubernetes hosts.

## Impact

To enable Private Nodes, the cluster has to also be configured with a private master IP range and IP Aliasing enabled.

Private Nodes do not have outbound access to the public internet. If you want to provide outbound Internet access for your private nodes, you can use Cloud NAT or you can manage your own NAT gateway.

## Audit Procedure

Check for the following to be 'enabled: true':

```bash
export CLUSTER_NAME=<your cluster name>
aws eks describe-cluster --name ${CLUSTER_NAME} --query "cluster.resourcesVpcConfig.endpointPrivateAccess"
```

Check for the following is not null:

```bash
export CLUSTER_NAME=<your cluster name>
aws eks describe-cluster --name ${CLUSTER_NAME} --query "cluster.resourcesVpcConfig.publicAccessCidrs"
```

Note: In addition include the check if the nodes are deployed in private subnets and no public IP is assigned. The private subnets should not be associated with a route table that has a route to an Internet Gateway (IGW).

## Remediation

```bash
aws eks update-cluster-config \
    --region region-code \
    --name my-cluster \
    --resources-vpc-config endpointPublicAccess=true,publicAccessCidrs="203.0.113.5/32",endpointPrivateAccess=true
```

## Default Value

By default, nodes are provisioned with public IP addresses.

## References

1. https://docs.aws.amazon.com/eks/latest/userguide/cluster-endpoint.html

## CIS Controls

| Controls Version | Control                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers | X    | X    | X    |
| v7               | 12 Boundary Defense                            |      |      |      |
