---
name: cis-aks-v180-5.4.5
description: "Encrypt traffic to HTTPS load balancers with TLS certificates (Manual)"
category: cis-aks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, networking, tls, https, encryption, load-balancer]
cis_id: "5.4.5"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.5 Encrypt traffic to HTTPS load balancers with TLS certificates (Manual)

## Profile Applicability

- Level 2

## Description

Encrypt traffic to HTTPS load balancers using TLS certificates.

## Rationale

Encrypting traffic between users and your Kubernetes workload is fundamental to protecting data sent over the web.

## Audit

Review the load balancer configurations to verify that TLS certificates are properly configured for HTTPS endpoints and that unencrypted HTTP traffic is not allowed.

## Remediation

Configure TLS certificates on all HTTPS load balancers serving traffic to the AKS cluster. Use Azure Application Gateway or an ingress controller with cert-manager to automate certificate management.

## References

1. https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-data-protection#dp-4-encrypt-sensitive-information-in-transit

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.10 Encrypt Sensitive Data in Transit | | x | x |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | | x | x |
