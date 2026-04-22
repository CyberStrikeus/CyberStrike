---
name: cis-oke-v180-5.1.4
description: "Minimize Container Registries to only those approved (Manual)"
category: cis-oke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, managed-services, image-registry, image-scanning, container-registry, ocir, trusted-registries]
cis_id: "5.1.4"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.4 Minimize Container Registries to only those approved (Manual)

## Profile Applicability

- Level 1

## Description

Limiting OKE clusters to pull images only from approved container registries is a key security control that prevents the deployment of unverified or malicious container images. By explicitly allowing access to trusted registries -- such as Oracle Cloud Infrastructure (OCI) Registry (OCIR) or other vetted enterprise repositories -- you ensure that all deployed containers come from sources that meet your organization's security, compliance, and provenance standards.

## Rationale

Allowing unrestricted access to external container registries provides the opportunity for malicious or unapproved containers to be deployed into the cluster. Allow listing only approved container registries reduces this risk.

## Impact

All container images to be deployed to the cluster must be hosted within an approved container image registry.

## Audit

Practice Recommendations:

1. Use Only Trusted Registries - Configure workloads to pull images exclusively from approved registries (e.g., iad.ocir.io, phx.ocir.io, or your enterprise repository).
2. Restrict Outbound Egress - Use Kubernetes Network Policies, OCI Network Security Groups (NSGs), or Security Lists to block access to public internet registries (e.g., Docker Hub) unless explicitly required.
3. Implement Image Pull Policies - Enforce imagePullPolicy: Always and deploy Admission Controllers (e.g., OPA Gatekeeper or Kyverno) to validate image sources before pods are admitted to the cluster.
4. Use Image Signing and Scanning - Enable OCIR Vulnerability Scanning or integrate third-party tools to ensure only signed and scanned images are allowed.

Audit Deployed Images regularly and periodically check for images from unapproved registries:

```bash
echo -e "NAMESPACE\tPOD_NAME\tIMAGE" && \
kubectl get pods -A -o jsonpath='{range .items[*]}{.metadata.namespace}{"\t"}{.metadata.name}{"\t"}{.spec.containers[*].image}{"\n"}{end}' \
| grep -vE '(iad\.ocir\.io|phx\.ocir\.io|your-approved-registry\.com)'
```

## Remediation

Minimize Container Registries to Only Approved Sources:

- **Define Approved Registries** - Establish a list of trusted registries (for example, iad.ocir.io//, phx.ocir.io//, or a private enterprise registry).
- **Restrict Pod Image Sources via Admission Controls**
- **Restrict Egress to Non-Approved Registries** - Use Kubernetes NetworkPolicies, OCI Network Security Groups (NSGs), or Security Lists to block egress traffic to public registries.
- **Enforce Image Scanning and Signing** - Enable OCI Vulnerability Scanning Service (VSS) for your OCIR repositories and allow only scanned and signed images to be deployed.

## Default Value

Oracle Kubernetes Engine (OKE) clusters do not restrict which container registries can be used for pulling images.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v7 | 5.2 Maintain Secure Images | | x | x |
| v7 | 5.3 Securely Store Master Images | | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1133, T1195 | TA0001, TA0003 | M1016, M1042 |
