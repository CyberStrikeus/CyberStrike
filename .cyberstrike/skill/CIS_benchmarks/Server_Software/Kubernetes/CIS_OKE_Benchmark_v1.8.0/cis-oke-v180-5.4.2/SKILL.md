---
name: cis-oke-v180-5.4.2
description: "Ensure clusters are created with Private Endpoint Enabled and Public Access Disabled (Automated)"
category: cis-oke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, managed-services, cluster-networking, private-endpoint, public-access, vcn, zero-trust]
cis_id: "5.4.2"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.2 Ensure clusters are created with Private Endpoint Enabled and Public Access Disabled (Automated)

## Profile Applicability

- Level 1

## Description

Creating Oracle Kubernetes Engine (OKE) clusters with Private Endpoint Enabled and Public Access Disabled ensures that the Kubernetes control plane (API server) is accessible only within the Oracle Cloud Infrastructure (OCI) Virtual Cloud Network (VCN). This configuration isolates cluster management traffic from the public internet, eliminating exposure to unauthorized external access. By keeping the API endpoint private, administrators and automation systems must connect securely through approved internal networks, VPNs, or bastion hosts. This practice aligns with Oracle and CIS Kubernetes security benchmarks, reducing attack surface and strengthening the overall security posture of the OKE environment.

## Rationale

Enabling a private endpoint and disabling public access for OKE clusters ensures that the Kubernetes control plane is accessible only from within trusted Oracle Cloud Infrastructure (OCI) networks. This prevents unauthorized internet-based access to the cluster's API server, reducing exposure to external threats such as brute-force attacks or exploitation of API vulnerabilities. Restricting control-plane communication to private networks enforces network segmentation, aligns with Zero Trust and CIS Kubernetes Benchmark best practices, and significantly enhances the security and integrity of the cluster's management plane.

## Impact

Failure to configure OKE clusters with Private Endpoint Enabled and Public Access Disabled exposes the Kubernetes control plane to the public internet, increasing the risk of unauthorized access, data breaches, and control-plane compromise. Restricting control-plane access to private networks is critical to maintaining a secure, compliant, and resilient Kubernetes environment.

1. Unauthorized Access Risk: Publicly exposed API endpoints can be discovered and targeted by attackers attempting to exploit misconfigurations or weak credentials.
2. Expanded Attack Surface: Allowing internet access to the control plane increases vulnerability to brute-force, denial-of-service, and reconnaissance attacks.
3. Regulatory Noncompliance: Public exposure of administrative interfaces can violate security and compliance frameworks such as ISO 27001.
4. Data and Service Disruption: A compromised control plane can lead to unauthorized cluster modifications, service outages, or data loss.

## Audit

Below is a command that lists both Private Endpoint = Enabled and Public Access = Disabled for all OKE clusters in a given compartment.

```bash
echo -e "NAME\tPRIVATE_ENDPOINT_ENABLED\tPUBLIC_ACCESS_DISABLED" && \
oci ce cluster list --compartment-id "${COMPARTMENT_ID}" --all --output json \
| jq -r '
  .data[] |
  . as $c |
  ($c.endpointConfig.isPublicIpEnabled // false) as $public |
  ($public | not) as $private |
  [
    $c.name,
    ($private | tostring),
    (( $public | not ) | tostring)
  ] | @tsv
'
```

Or check for the following:

```bash
oci ce cluster get --cluster-id "${CLUSTER_ID}" --query 'data."endpoint-config"."is-public-ip-enabled"' --output json
```

Output shows either:

- `false` - Private endpoint enabled (no public access).
- `true` - Public access enabled (private endpoint disabled).

## Remediation

If an OKE cluster is configured with a public control plane endpoint, it should be disabled to reduce exposure and prevent unauthorized access from the internet. Configuring the cluster with a private endpoint ensures that the Kubernetes API server is accessible only within the Oracle Cloud Infrastructure (OCI) Virtual Cloud Network (VCN).

Update statement to disable the public control plane endpoint:

```bash
oci ce cluster update-endpoint-config \
  --cluster-id "${CLUSTER_ID}" \
  --is-public-ip-enabled false \
  --force
```

The OKE control plane endpoint is now private and no longer reachable from the public internet, ensuring that administrative traffic stays within trusted network boundaries.

## Default Value

By default, the Public Endpoint is disabled.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 9.3 Maintain and Enforce Network-Based URL Filters | | x | x |
| v7 | 7.4 Maintain and Enforce Network-Based URL Filters | | x | x |
