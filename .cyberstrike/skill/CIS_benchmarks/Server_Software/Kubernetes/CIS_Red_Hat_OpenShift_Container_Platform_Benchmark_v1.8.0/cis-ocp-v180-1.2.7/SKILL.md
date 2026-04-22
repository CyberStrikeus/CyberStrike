---
name: cis-ocp-v180-1.2.7
description: "Ensure that the APIPriorityAndFairness feature gate is enabled (Manual)"
category: cis-openshift
version: "1.8.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server]
cis_id: "1.2.7"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.8.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.8.0 - Control 1.2.7

## Profile Applicability
- **Level:** 1

## Description
Limit the rate at which the API server accepts requests.

## Rationale
A misbehaving workload could overwhelm and DoS the API Server, making it unavailable. This particularly applies to a multi-tenant cluster, where there might be a small percentage of misbehaving tenants which could have a significant impact on the performance of the cluster overall. Hence, it is recommended to limit the rate of events that the API server will accept.

## Impact
None, as the OpenShift kubelet has been fixed to send fewer requests.

## Audit Procedure
OpenShift 4.5 and forward uses the api priority and fairness feature to limit the rate at which the API server accepts requests.

Run the following command:

```bash
#Verify the APIPriorityAndFairness feature-gate
oc get kubeapiservers.operator.openshift.io cluster -o json | jq '.spec.observedConfig.apiServerArguments'
```

For 4.5, verify that the feature-gate is turned on for the APIServer priority and fairness: `APIPriorityAndFairness=true`. In OCP 4.5 and earlier, the default set of admission plugins are compiled into the `apiserver` and are not visible in the configuration yaml.

## Remediation
No remediation is required.

## Default Value
By default, the OpenShift kubelet has been fixed to send fewer requests. Version 4.6+ it is enabled by default.

## References
1. https://docs.openshift.com/container-platform/4.13/operators/operator-reference.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 12.6 Use of Secure Network Management and Communication Protocols | | * | * |
| v7 | 8.3 Enable Operating System Anti-Exploitation Features / Deploy Anti-Exploit Technologies | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1609 | TA0002 | M1028 |

## Profile
**Level 1** (Manual)
