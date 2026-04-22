---
name: cis-k8s-v1111-5.5.1
description: "Configure Image Provenance using ImagePolicyWebhook admission controller (Manual)"
category: cis-k8s
version: "1.11.1"
author: cyberstrike-official
tags: [cis, kubernetes, policies, admission-control, webhooks, image-provenance]
cis_id: "5.5.1"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.1"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.5.1 Configure Image Provenance using ImagePolicyWebhook admission controller (Manual)

## Profile Applicability

- Level 2 - Master Node

## Description

Configure Image Provenance for your deployment.

## Rationale

Kubernetes supports plugging in provenance rules to accept or reject the images in your deployments. You could configure such rules to ensure that only approved images are deployed in the cluster.

## Impact

You need to regularly maintain your provenance configuration based on container image updates.

## Audit

Review the pod definitions in your cluster and verify that image provenance is configured as appropriate.

## Remediation

Follow the Kubernetes documentation and setup image provenance.

## Default Value

By default, image provenance is not set.

## References

1. https://kubernetes.io/docs/admin/admission-controllers/#imagepolicywebhook
2. https://github.com/kubernetes/community/blob/master/contributors/design-proposals/image-provenance.md
3. https://hub.docker.com/r/dnurmi/anchore-toolbox/
4. https://github.com/kubernetes/kubernetes/issues/22888

## CIS Controls

| Controls Version | Control                                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure |      | X    | X    |
| v7               | 5.2 Maintain Secure Images                                                         |      | X    | X    |
