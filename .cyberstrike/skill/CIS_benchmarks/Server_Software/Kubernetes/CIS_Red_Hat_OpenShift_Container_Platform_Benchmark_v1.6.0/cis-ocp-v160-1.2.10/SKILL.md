---
name: cis-ocp-v160-1.2.10
description: "Ensure that the admission control plugin AlwaysAdmit is not set (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server, admission-control]
cis_id: "1.2.10"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 1.2.10

## Profile Applicability
- **Level:** 1

## Description
Do not allow all requests.

## Rationale
Setting admission control plugin `AlwaysAdmit` allows all requests and does not filter any requests.

The `AlwaysAdmit` admission controller was deprecated in Kubernetes v1.13. Its behavior was equivalent to turning off all admission controllers.

## Impact
Only requests explicitly allowed by the admissions control plugins would be served.

## Audit Procedure
This controller is disabled by default in OpenShift and cannot be enabled. It has also been deprecated by the Kubernetes community as it behaves as if there were no controller.

Use the following command to verify the configured admission controllers:

```bash
oc -n openshift-kube-apiserver get configmap config -o json | jq -r '.data."config.yaml"' | jq '.apiServerArguments."enable-admission-plugins"'
```

The output should not include `AlwaysAdmit`.

## Remediation
None.

## Default Value
This `AlwaysAdmit` controller is disabled by default in OpenShift and cannot be enabled.

## References
1. https://docs.openshift.com/container-platform/latest/architecture/admission-plug-ins.html
2. https://github.com/openshift/cluster-kube-apiserver-operator/blob/release-4.6/bindata/v4.1.0/config/defaultconfig.yaml#L34-L78
3. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
4. https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/#alwaysadmit

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1133 | TA0001 | M1026 |

## Profile
**Level 1** (Manual)
