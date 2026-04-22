---
name: cis-gke-v170-5.10.5
description: "Enable Security Posture (Manual)"
category: cis-gke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, cluster-config, security-posture, configuration-scanning, workload-security]
cis_id: "5.10.5"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.7.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.10.5 Enable Security Posture (Manual)

## Profile Applicability

- Level 2

## Description

Enable Security Posture to gain insights about your workload security posture at the runtime phase of the software delivery life-cycle.

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

The output should include:

```
securityPostureConfig:
  mode: BASIC
```

## Remediation

Enable security posture via the UI, gCloud or API.

See: https://cloud.google.com/kubernetes-engine/docs/how-to/protect-workload-configuration

## Default Value

GKE security posture has multiple features. Not all are on by default. Configuration auditing is enabled by default for new standard and autopilot clusters.

securityPostureConfig: mode: BASIC

## References

1. https://cloud.google.com/kubernetes-engine/docs/concepts/about-security-posture-dashboard
