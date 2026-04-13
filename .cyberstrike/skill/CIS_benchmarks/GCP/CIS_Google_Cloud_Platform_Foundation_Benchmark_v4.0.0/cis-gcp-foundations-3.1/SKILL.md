---
name: cis-gcp-foundations-3.1
description: "Ensure That the Default Network Does Not Exist in a Project"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, networking, vpc, firewall]
cis_id: "3.1"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1 Ensure That the Default Network Does Not Exist in a Project (Automated)

## Profile Applicability

- Level 2

## Description

To prevent use of `default` network, a project should not have a `default` network.

## Rationale

The `default` network has a preconfigured network configuration and automatically generates the following insecure firewall rules:

- **default-allow-internal:** Allows ingress connections for all protocols and ports among instances in the network.
- **default-allow-ssh:** Allows ingress connections on TCP port 22 (SSH) from any source to any instance in the network.
- **default-allow-rdp:** Allows ingress connections on TCP port 3389 (RDP) from any source to any instance in the network.
- **default-allow-icmp:** Allows ingress ICMP traffic from any source to any instance in the network.

These automatically created firewall rules do not get audit logged by default.

Furthermore, the default network is an auto mode network, which means that its subnets use the same predefined range of IP addresses, and as a result, it's not possible to use Cloud VPN or VPC Network Peering with the default network.

Based on organization security and networking requirements, the organization should create a new network and delete the `default` network.

## Impact

When an organization deletes the default network, it will need to remove all assets from that network and migrate them to a new network.

## Audit

### From Google Cloud Console

1. Go to the `VPC networks` page by visiting: https://console.cloud.google.com/networking/networks/list
2. Ensure that a network with the name `default` is not present.

### From Google Cloud CLI

1. Set the project name in the Google Cloud Shell:

```bash
gcloud config set project PROJECT_ID
```

2. List the networks configured in that project:

```bash
gcloud compute networks list
```

It should not list `default` as one of the available networks in that project.

## Remediation

### From Google Cloud Console

1. Go to the `VPC networks` page by visiting: https://console.cloud.google.com/networking/networks/list
2. Click the network named `default`.
3. On the network detail page, click `EDIT`.
4. Click `DELETE VPC NETWORK`.
5. If needed, create a new network to replace the default network.

### From Google Cloud CLI

For each Google Cloud Platform project,

1. Delete the default network:

```bash
gcloud compute networks delete default
```

2. If needed, create a new network to replace it:

```bash
gcloud compute networks create NETWORK_NAME
```

## Prevention

The user can prevent the default network and its insecure default firewall rules from being created by setting up an Organization Policy to `Skip default network creation` at https://console.cloud.google.com/iam-admin/orgpolicies/compute-skipDefaultNetworkCreation.

## Default Value

By default, for each project, a `default` network is created.

## References

1. https://cloud.google.com/compute/docs/networking#firewall_rules
2. https://cloud.google.com/compute/docs/reference/latest/networks/insert
3. https://cloud.google.com/compute/docs/reference/latest/networks/delete
4. https://cloud.google.com/vpc/docs/firewall-rules-logging
5. https://cloud.google.com/vpc/docs/vpc#default-network
6. https://cloud.google.com/sdk/gcloud/reference/compute/networks/delete

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4.2 Establish and Maintain a Secure Configuration Process for Network Infrastructure | x | x | x |
| v7 | 11.1 Maintain Standard Security Configurations for Network Devices | | x | x |
