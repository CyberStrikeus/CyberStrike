---
name: cis-eks-v180-5.4.2
description: "Ensure clusters are created with Private Endpoint Enabled and Public Access Disabled (Automated)"
category: cis-eks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, networking, private-endpoint, public-access, api-server]
cis_id: "5.4.2"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.8.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.2 Ensure clusters are created with Private Endpoint Enabled and Public Access Disabled (Automated)

## Profile Applicability

- Level 1

## Description

Disable access to the Kubernetes API from outside the node network if it is not required.

## Rationale

In a private cluster, the master node has two endpoints, a private and public endpoint. The private endpoint is the internal IP address of the master, behind an internal load balancer in the master's VPC network. Nodes communicate with the master using the private endpoint. The public endpoint enables the Kubernetes API to be accessed from outside the master's VPC network.

Although Kubernetes API requires an authorized token to perform sensitive actions, a vulnerability could potentially expose the Kubernetes publicly with unrestricted access. Additionally, an attacker may be able to identify the current cluster and Kubernetes API version and determine whether it is vulnerable to an attack. Unless required, disabling public endpoint will help prevent such threats, and require the attacker to be on the master's VPC network to perform any attack on the Kubernetes API.

## Impact

Configure the EKS cluster endpoint to be private.

1. Leave the cluster endpoint public and specify which CIDR blocks can communicate with the cluster endpoint. The blocks are effectively a whitelisted set of public IP addresses that are allowed to access the cluster endpoint.
2. Configure public access with a set of whitelisted CIDR blocks and set private endpoint access to enabled. This will allow public access from a specific range of public IPs while forcing all network traffic between the kubelets (workers) and the Kubernetes API through the cross-account ENIs that get provisioned into the cluster VPC when the control plane is provisioned.

## Audit Procedure

Check for private endpoint access to the Kubernetes API server. Check for the following to be 'enabled: false':

```bash
export CLUSTER_NAME=<your cluster name>
aws eks describe-cluster --name ${CLUSTER_NAME} --query "cluster.resourcesVpcConfig.endpointPublicAccess"
```

Check for the following to be 'enabled: true':

```bash
export CLUSTER_NAME=<your cluster name>
aws eks describe-cluster --name ${CLUSTER_NAME} --query "cluster.resourcesVpcConfig.endpointPrivateAccess"
```

## Remediation

By enabling private endpoint access to the Kubernetes API server, all communication between your nodes and the API server stays within your VPC.

With this in mind, you can update your cluster accordingly using the AWS CLI to ensure that Private Endpoint Access is enabled.

For example, the following command would enable private access to the Kubernetes API and ensure that no public access is permitted:

```bash
aws eks update-cluster-config --region $AWS_REGION --name $CLUSTER_NAME --resources-vpc-config endpointPrivateAccess=true,endpointPublicAccess=false
```

Note: For more detailed information, see the EKS Cluster Endpoint documentation link in the references section.

## Default Value

By default, the Public Endpoint is disabled.

## References

1. https://docs.aws.amazon.com/eks/latest/userguide/cluster-endpoint.html

## CIS Controls

| Controls Version | Control                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers | X    | X    | X    |
| v7               | 12 Boundary Defense                            |      |      |      |
