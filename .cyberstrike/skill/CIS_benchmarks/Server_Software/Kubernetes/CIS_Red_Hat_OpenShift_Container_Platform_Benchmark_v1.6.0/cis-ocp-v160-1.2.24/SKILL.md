---
name: cis-ocp-v160-1.2.24
description: "Ensure that the --request-timeout argument is set (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server, request-timeout]
cis_id: "1.2.24"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 1.2.24

## Profile Applicability
- **Level:** 1

## Description
The API server minimum request timeout defines the minimum number of seconds a handler must keep a request open before timing it out.

## Rationale
Setting global request timeout allows extending the API server request timeout limit to a duration appropriate to the user's connection speed. By default, it is set to 3600 seconds in OpenShift 4. Allowing users to set this timeout limit to be too small can be insufficient for some connections and too large can exhaust the API server resources making it prone to Denial-of-Service attack. Hence, it is not supported to adjust this value in OpenShift 4.

## Impact
None

## Audit Procedure
OpenShift configures the `min-request-timeout` flag via `apiServerArguments[min-request-timeout]`, which overrides `request-timeout` and provides a more balanced timeout approach.

Run the following command:

```bash
oc get configmap config -n openshift-kube-apiserver -ojson | jq -r '.data["config.yaml"]' |
jq '.apiServerArguments["min-request-timeout"]'
```

Verify that the `min-request-timeout` argument is set to 3600.

## Remediation
None

## Default Value
By default, `min-request-timeout` is set to 3600 seconds in OpenShift 4.

## References
1. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#kube-apiserver-operator_red-hat-operators
2. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#openshift-apiserver-operator_red-hat-operators
3. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
4. https://github.com/kubernetes/kubernetes/pull/51415

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process | x | x | x |
| v7 | 5.1 Establish Secure Configurations | x | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1499 | TA0040 | M1037 |

## Profile
**Level 1** (Manual)
