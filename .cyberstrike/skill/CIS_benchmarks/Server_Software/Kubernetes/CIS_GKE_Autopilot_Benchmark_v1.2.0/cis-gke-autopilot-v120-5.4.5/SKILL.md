---
name: cis-gke-autopilot-v120-5.4.5
description: "Ensure use of Google-managed SSL Certificates (Automated)"
category: cis-gke-autopilot
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gke-autopilot, kubernetes, gcp, networking, private-cluster, vpc, flow-logs, firewall]
cis_id: "5.4.5"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Autopilot Benchmark v1.2.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.5 Ensure use of Google-managed SSL Certificates (Automated)

## Profile Applicability

- Level 2

## Description

Encrypt traffic to HTTPS load balancers using Google-managed SSL certificates.

## Rationale

Encrypting traffic between users and the Kubernetes workload is fundamental to protecting data sent over the web.

Google-managed SSL Certificates are provisioned, renewed, and managed for domain names. This is only available for HTTPS load balancers created using Ingress Resources, and not TCP/UDP load balancers created using Service of `type:LoadBalancer`.

## Impact

Google-managed SSL Certificates are less flexible than certificates that are self obtained and managed. Managed certificates support a single, non-wildcard domain. Self-managed certificates can support wildcards and multiple subject alternative names (SANs).

## Audit

**Using Command Line:**
Identify if there are any workloads exposed publicly using Services of `type:LoadBalancer`:

```bash
kubectl get svc -A -o json | jq '.items[] | select(.spec.type=="LoadBalancer")'
```

Consider using ingresses instead of these services in order to use Google managed SSL certificates.

For the ingresses within the cluster, run the following command:

```bash
kubectl get ingress -A -o json | jq .items[] | jq '{name: .metadata.name, annotations: .metadata.annotations, namespace: .metadata.namespace, status: .status}'
```

The above command should return the name of the ingress, namespace, annotations and status. Check that the following annotation is present to ensure managed certificates are referenced.

```json
"annotations": {
    ...
    "networking.gke.io/managed-certificates": "<example_certificate>"
},
```

For completeness, run the following command to ensure that the managed certificate resource exists:

```bash
kubectl get managedcertificates -A
```

The above command returns a list of managed certificates for which `<example_certificate>` should exist within the same namespace as the ingress.

## Remediation

If services of `type:LoadBalancer` are discovered, consider replacing the Service with an Ingress.

To configure the Ingress and use Google-managed SSL certificates, follow the instructions as listed at: https://cloud.google.com/kubernetes-engine/docs/how-to/managed-certs.

## Default Value

By default, Google-managed SSL Certificates are not created when an Ingress resource is defined.

## References

1. https://cloud.google.com/kubernetes-engine/docs/how-to/managed-certs
2. https://cloud.google.com/kubernetes-engine/docs/concepts/ingress

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.10 Encrypt Sensitive Data in Transit | | x | x |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | | x | x |
