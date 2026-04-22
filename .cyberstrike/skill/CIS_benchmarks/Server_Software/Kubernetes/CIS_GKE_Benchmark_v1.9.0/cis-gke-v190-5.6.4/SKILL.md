---
name: cis-gke-v190-5.6.4
description: "Ensure clusters are created with Private Endpoint Enabled and Public Access Disabled (Automated)"
category: cis-gke
version: "1.9.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, networking, private-endpoint, private-cluster, public-access]
cis_id: "5.6.4"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.9.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.6.4 Ensure clusters are created with Private Endpoint Enabled and Public Access Disabled (Automated)

## Profile Applicability

- Level 2

## Description

Disable access to the Kubernetes API from outside the node network if it is not required.

## Rationale

In a private cluster, the master node has two endpoints, a private and public endpoint. The private endpoint is the internal IP address of the master, behind an internal load balancer in the master's VPC network. Nodes communicate with the master using the private endpoint. The public endpoint enables the Kubernetes API to be accessed from outside the master's VPC network.

Although Kubernetes API requires an authorized token to perform sensitive actions, a vulnerability could potentially expose the Kubernetes publically with unrestricted access. Additionally, an attacker may be able to identify the current cluster and Kubernetes API version and determine whether it is vulnerable to an attack. Unless required, disabling public endpoint will help prevent such threats, and require the attacker to be on the master's VPC network to perform any attack on the Kubernetes API.

## Impact

To enable a Private Endpoint, the cluster has to also be configured with private nodes, a private master IP range and IP aliasing enabled.

If the Private Endpoint flag `--enable-private-endpoint` is passed to the gcloud CLI, or the external IP address undefined in the Google Cloud Console during cluster creation, then all access from a public IP address is prohibited.

## Audit

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting https://console.cloud.google.com/kubernetes/list
2. Select the required cluster, and within the Details pane, make sure the 'Endpoint' does not have a public IP address.

**Using Command Line:**

Run this command:

```bash
gcloud container clusters describe <cluster_name> --format json | jq '.privateClusterConfig.enablePrivateEndpoint'
```

The output of the above command returns `true` if a Private Endpoint is enabled with Public Access disabled.

For an additional check, the endpoint parameter can be queried with the following command:

```bash
gcloud container clusters describe <cluster_name> --format json | jq '.endpoint'
```

The output of the above command returns a private IP address if Private Endpoint is enabled with Public Access disabled.

## Remediation

Once a cluster is created without enabling Private Endpoint only, it cannot be remediated. Rather, the cluster must be recreated.

**Using Google Cloud Console:**

1. Go to Kubernetes Engine by visiting https://console.cloud.google.com/kubernetes/list
2. Click CREATE CLUSTER, and choose CONFIGURE for the Standard mode cluster.
3. Configure the cluster as required then click Networking under CLUSTER in the navigation pane.
4. Under IPv4 network access, click the Private cluster radio button.
5. Uncheck the Access control plane using its external IP address checkbox.
6. In the Control plane IP range textbox, provide an IP range for the control plane.
7. Configure the other settings as required, and click CREATE.

**Using Command Line:**

Create a cluster with a Private Endpoint enabled and Public Access disabled by including the `--enable-private-endpoint` flag within the cluster create command:

```bash
gcloud container clusters create <cluster_name> --enable-private-endpoint
```

Setting this flag also requires the setting of `--enable-private-nodes`, `--enable-ip-alias` and `--master-ipv4-cidr=<master_cidr_range>`.

## Default Value

By default, the Private Endpoint is disabled.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/private-clusters

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.4 Implement and Manage a Firewall on Servers | x | x | x |
| v7 | 12 Boundary Defense | | | |
