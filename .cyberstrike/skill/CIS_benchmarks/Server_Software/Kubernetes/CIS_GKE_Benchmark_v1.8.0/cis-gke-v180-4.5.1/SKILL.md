---
name: cis-gke-v180-4.5.1
description: "Configure Image Provenance using ImagePolicyWebhook admission controller (Manual)"
category: cis-gke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, admission-control, webhooks, image-provenance]
cis_id: "4.5.1"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.8.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.5.1 Configure Image Provenance using ImagePolicyWebhook admission controller (Manual)

## Profile Applicability

- Level 2

## Description

Configure Image Provenance for the deployment.

## Rationale

Kubernetes supports plugging in provenance rules to accept or reject the images in deployments. Rules can be configured to ensure that only approved images are deployed in the cluster.

Also see recommendation 5.1.4.

## Impact

Regular maintenance for the provenance configuration should be carried out, based on container image updates.

## Audit

Review the pod definitions in the cluster and verify that image provenance is configured as appropriate.
Also see recommendation 5.1.4.

## Remediation

Follow the Kubernetes documentation and setup image provenance.
Also see recommendation 5.1.4.

## Default Value

By default, image provenance is not set.

## References

1. https://kubernetes.io/docs/concepts/containers/images/
2. https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/

## CIS Controls

| Controls Version | Control                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.6 Securely Manage Enterprise Assets and Software | \*   | \*   | \*   |
| v7               | 18 Application Software Security                   |      |      |      |
