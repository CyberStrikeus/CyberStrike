---
name: cis-oke-v180-5.4.1
description: "Restrict Access to the Control Plane Endpoint (Automated)"
category: cis-oke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, managed-services, cluster-networking, control-plane, api-server, authorized-ip-cidrs]
cis_id: "5.4.1"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.1 Restrict Access to the Control Plane Endpoint (Automated)

## Profile Applicability

- Level 1

## Description

Enable Authorized IP CIDRs `endpointConfig.authorizedIpCidrs`, used together with `isPublicIpEnabled` to restrict or disable control-plane access. These settings define which IP CIDRs can reach the Kubernetes API server (control plane endpoint).

## Rationale

Restricting access to the Oracle Kubernetes Engine (OKE) cluster control plane through the Authorized IP CIDRs list (`endpointConfig.authorizedIpCidrs`), in combination with the `isPublicIpEnabled` setting, is a critical security control that ensures only trusted administrative networks or systems can reach the Kubernetes API server.

By default, enabling a public control plane endpoint without restrictions exposes the cluster's management interface to the internet, increasing the risk of unauthorized access, brute-force attacks, or exploitation of exposed API vulnerabilities. The Authorized IP CIDRs list acts as a network-level allowlist, explicitly defining which external IP address ranges are permitted to communicate with the cluster's API server.

When used together with `isPublicIpEnabled=false`, this configuration can completely isolate the control plane within the Virtual Cloud Network (VCN), allowing only internal traffic or secure connections via bastion hosts or VPNs. In cases where `isPublicIpEnabled=true` is required for operational purposes, defining a precise Authorized IP CIDR range ensures that only approved administrators or automation systems can manage the cluster remotely.

## Impact

Failure to implement the Authorized IP CIDRs list in conjunction with `isPublicIpEnabled` exposes the OKE cluster control plane to unauthorized network access. This increases the risk of external attacks, including credential theft, denial-of-service attempts, or exploitation of API vulnerabilities. Conversely, enforcing these settings significantly reduces the cluster's attack surface, ensuring that only trusted networks and administrators can interact with the Kubernetes API, thereby maintaining the integrity and confidentiality of the cluster's management plane.

## Audit

Below is a command-line audit procedure to verify that each OKE cluster control plane (master endpoint) is properly restricted using the Authorized IP CIDRs list (`endpointConfig.authorizedIpCidrs`) and the `isPublicIpEnabled` setting.

```bash
echo -e "NAME\tPUBLIC\tAUTHORIZED_CIDRS" && \
oci ce cluster list --compartment-id "${COMPARTMENT_ID}" --all --output json \
| jq -r '
  .data[] |
  . as $c |
  ($c.endpointConfig.isPublicIpEnabled // false) as $pub |
  ($c.endpointConfig.authorizedIpCidrs // []) as $cidrs |
  [$c.name, $pub, ($cidrs | join(","))] | @tsv
'
```

Or check the following:

```bash
export CLUSTER_ID=<oke cluster id>
oci ce cluster get --cluster-id $CLUSTER_ID
```

Check for endpoint URL of the Kubernetes API Server in output.

## Remediation

If the OKE cluster control plane is publicly accessible without an authorized IP allowlist, update the endpoint configuration to either disable public access or restrict it to specific trusted IP ranges. This ensures only approved administrative networks can reach the Kubernetes API server, reducing exposure to unauthorized access.

**Restrict to Authorized IPs:**

```bash
oci ce cluster update-endpoint-config \
  --cluster-id "${CLUSTER_ID}" \
  --is-public-ip-enabled true \
  --authorized-ip-cidrs '["203.0.113.10/32","198.51.100.0/24"]' \
  --force
```

**Or make endpoint private only:**

```bash
oci ce cluster update-endpoint-config \
  --cluster-id "${CLUSTER_ID}" \
  --is-public-ip-enabled false \
  --force
```

## Default Value

`isPublicIpEnabled` is defaulted to true and `authorizedIpCidrs` is defaulted to [] (empty list).

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 9.3 Maintain and Enforce Network-Based URL Filters | | x | x |
| v7 | 7.5 Subscribe to URL-Categorization service | | x | x |
