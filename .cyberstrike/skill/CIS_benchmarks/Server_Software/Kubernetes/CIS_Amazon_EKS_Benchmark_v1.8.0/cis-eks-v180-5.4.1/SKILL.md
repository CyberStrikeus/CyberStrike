---
name: cis-eks-v180-5.4.1
description: "Restrict Access to the Control Plane Endpoint (Automated)"
category: cis-eks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, networking, control-plane, endpoint, access-control]
cis_id: "5.4.1"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.8.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.1 Restrict Access to the Control Plane Endpoint (Automated)

## Profile Applicability

- Level 1

## Description

Enable Endpoint Private Access to restrict access to the cluster's control plane to only an allowlist of authorized IPs.

## Rationale

Authorized networks are a way of specifying a restricted range of IP addresses that are permitted to access your cluster's control plane. Kubernetes Engine uses both Transport Layer Security (TLS) and authentication to provide secure access to your cluster's control plane from the public internet. This provides you the flexibility to administer your cluster from anywhere; however, you might want to further restrict access to a set of IP addresses that you control. You can set this restriction by specifying an authorized network.

Restricting access to an authorized network can provide additional security benefits for your container cluster, including:

- **Better protection from outsider attacks:** Authorized networks provide an additional layer of security by limiting external access to a specific set of addresses you designate, such as those that originate from your premises. This helps protect access to your cluster in the case of a vulnerability in the cluster's authentication or authorization mechanism.
- **Better protection from insider attacks:** Authorized networks help protect your cluster from accidental leaks of master certificates from your company's premises. Leaked certificates used from outside Cloud Services and outside the authorized IP ranges (for example, from addresses outside your company) are still denied access.

## Impact

When implementing Endpoint Private Access, be careful to ensure all desired networks are on the allowlist (whitelist) to prevent inadvertently blocking external access to your cluster's control plane.

## Audit Procedure

Check for the following to be 'enabled: true':

```bash
export CLUSTER_NAME=<your cluster name>
aws eks describe-cluster --name ${CLUSTER_NAME} --query "cluster.resourcesVpcConfig.endpointPublicAccess"

aws eks describe-cluster --name ${CLUSTER_NAME} --query "cluster.resourcesVpcConfig.endpointPrivateAccess"
```

Check for the following is not null:

```bash
export CLUSTER_NAME=<your cluster name>
aws eks describe-cluster --name ${CLUSTER_NAME} --query "cluster.resourcesVpcConfig.publicAccessCidrs"
```

## Remediation

By enabling private endpoint access to the Kubernetes API server, all communication between your nodes and the API server stays within your VPC. You can also limit the IP addresses that can access your API server from the internet, or completely disable internet access to the API server.

With this in mind, you can update your cluster accordingly using the AWS CLI to ensure that Private Endpoint Access is enabled.

If you choose to also enable Public Endpoint Access then you should also configure a list of allowable CIDR blocks, resulting in restricted access from the internet. If you specify no CIDR blocks, then the public API server endpoint is able to receive and process requests from all IP addresses by defaulting to ['0.0.0.0/0'].

For example, the following command would enable private access to the Kubernetes API as well as limited public access over the internet from a single IP address (noting the /32 CIDR suffix):

```bash
aws eks update-cluster-config --region $AWS_REGION --name $CLUSTER_NAME --resources-vpc-config endpointPrivateAccess=true,endpointPrivateAccess=true,publicAccessCidrs="203.0.113.5/32"
```

Note:

- The CIDR blocks specified cannot include reserved addresses.
- There is a maximum number of CIDR blocks that you can specify. For more information, see the EKS Service Quotas link in the references section.
- For more detailed information, see the EKS Cluster Endpoint documentation link in the references section.

## Default Value

By default, Endpoint Public Access is disabled.

## References

1. https://docs.aws.amazon.com/eks/latest/userguide/cluster-endpoint.html

## CIS Controls

| Controls Version | Control                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers     | X    | X    | X    |
| v8               | 9.3 Maintain and Enforce Network-Based URL Filters |      | X    | X    |
| v7               | 7.4 Maintain and Enforce Network-Based URL Filters |      | X    | X    |
