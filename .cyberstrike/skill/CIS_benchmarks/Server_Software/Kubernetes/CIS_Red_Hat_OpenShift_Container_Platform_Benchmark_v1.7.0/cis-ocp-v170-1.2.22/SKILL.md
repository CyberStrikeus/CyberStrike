---
name: cis-ocp-v170-1.2.22
description: "Ensure that the maximumRetainedFiles argument is set to 10 or as appropriate (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server]
cis_id: "1.2.22"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 1.2.22

## Profile Applicability
- **Level:** 1

## Description
Retain 10 or an appropriate number of old log files.

## Rationale
Kubernetes automatically rotates the log files. Retaining old log files ensures that you would have sufficient log data available for carrying out any investigation or correlation. For example, if you have set file size of 100 MB and the number of old log files to keep as 10, you would have approximately 1 GB of log data that you could potentially use for your analysis.

## Impact
None.

## Audit Procedure
OpenShift audit works at the API server level, logging all requests coming to the server.

Run the following command to verify the number of retained log files:

```bash
oc get configmap config -n openshift-kube-apiserver -ojson | jq -r '.data["config.yaml"]' | jq -r '.apiServerArguments["audit-log-maxbackup"][]?'
```

Verify the output is at least `10`.

## Remediation
None.

## Default Value
By default, auditing is enabled and the maximum audit log backup is set to `10`.

## References
1. https://access.redhat.com/solutions/4262201
2. https://docs.openshift.com/container-platform/latest/security/audit-log-policy-config.html
3. https://github.com/openshift/cluster-kube-apiserver-operator/blob/master/bindata/v4.1.0/config/defaultconfig.yaml#L165-168
4. https://github.com/openshift/cluster-authentication-operator/blob/master/bindata/oauth-apiserver/deploy.yaml
5. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
6. https://kubernetes.io/docs/tasks/debug-application-cluster/audit/
7. https://github.com/kubernetes/features/issues/22
8. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.3 Ensure Adequate Audit Log Storage | * | * | * |
| v7 | 6.4 Ensure adequate storage for logs | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1543 | TA0003, TA0004 | M1047 |

## Profile
**Level 1** (Manual)
