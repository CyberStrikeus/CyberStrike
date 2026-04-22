---
name: cis-gke-autopilot-v130-5.7.1
description: "Enable Security Posture (Automated)"
category: cis-gke-autopilot
version: "1.3.0"
author: cyberstrike-official
tags: [cis, gke-autopilot, kubernetes, gcp, cluster-config, security-posture, metadata]
cis_id: "5.7.1"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Autopilot Benchmark v1.3.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.7.1 Enable Security Posture (Automated)

## Profile Applicability

- Level 2

## Description

The security posture dashboard provides insights about your workload security posture at the runtime phase of the software delivery life-cycle.

## Rationale

The security posture dashboard provides insights about your workload security posture at the runtime phase of the software delivery life-cycle.

## Impact

GKE security posture configuration auditing checks your workloads against a set of defined best practices. Each configuration check has its own impact or risk. Learn more about the checks: https://cloud.google.com/kubernetes-engine/docs/concepts/about-configuration-scanning

Example: The host namespace check identifies pods that share host namespaces. Pods that share host namespaces allow Pod processes to communicate with host processes and gather host information, which could lead to a container escape.

## Audit

Check the SecurityPostureConfig on your cluster:

```bash
gcloud container clusters --location describe
```

```
securityPostureConfig: mode: BASIC
```

## Remediation

Enable security posture via the UI, gCloud or API. https://cloud.google.com/kubernetes-engine/docs/how-to/protect-workload-configuration

## Default Value

GKE security posture has multiple features. Not all are on by default. Configuration auditing is enabled by default for new standard and autopilot clusters.

securityPostureConfig: mode: BASIC

## References

1. https://cloud.google.com/kubernetes-engine/docs/concepts/about-security-posture-dashboard

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 2.4 Utilize Automated Software Inventory Tools | | x | x |
| v7 | 5.5 Implement Automated Configuration Monitoring Systems | | x | x |
