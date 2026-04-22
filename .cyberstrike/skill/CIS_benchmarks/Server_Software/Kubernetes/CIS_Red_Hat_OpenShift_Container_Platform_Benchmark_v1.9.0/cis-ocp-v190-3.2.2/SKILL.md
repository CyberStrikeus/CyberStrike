---
name: cis-ocp-v190-3.2.2
description: "Ensure that the audit policy covers key security concerns (Manual)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, logging, audit-policy, security-concerns, audit-logging]
cis_id: "3.2.2"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 3.2.2

## Profile Applicability
- **Level:** 2

## Description
Ensure that the audit policy created for the cluster covers key security concerns.

## Rationale
Security audit logs should cover access and modification of key resources in the cluster, to enable them to form an effective part of a security environment.

## Impact
Increasing audit logging will consume resources on the nodes or other log destinations.

## Audit Procedure
Review the audit policy provided for the cluster and ensure that it covers the following areas:

- The use of sensitive resources like `Secrets`, `ConfigMaps`, and `TokenReviews` are logged at the `Metadata` level
- Modifications to `pods` and `deployments` are logged at the `Request` level
- The use of `pods/exec`, `pods/portforward`, `pods/proxy`, and `services/proxy` are at least logged at the `Metadata` level

For most requests, minimally logging at the `Metadata` level is recommended (the most basic level of logging).

You can configure the audit feature to set log level, retention policy, and the type of events to log. You can set the log level settings for an overall component or the API server to one of the following. The setting can be different for each setting.

Use the following command to view the audit policies for the Kubernetes API server:

```bash
oc get configmap -n openshift-kube-apiserver kube-apiserver-audit-policies -o json | jq -r '.data."policy.yaml"'
```

Use the following command to view the audit policies for the OpenShift API server:

```bash
oc get configmap -n openshift-apiserver audit -o json | jq -r '.data."policy.yaml"'
```

## Remediation
Update the audit log policy profile to use `WriteRequestBodies`.

## Default Value
Audit logging is configured by default using the `Default` audit policy, but you are advised to review the log retention settings and log levels to align with your cluster's security posture.

## References
1. https://docs.openshift.com/container-platform/latest/security/audit-log-policy-config.html
2. https://docs.openshift.com/container-platform/latest/security/audit-log-view.html
3. https://github.com/openshift/cluster-kube-apiserver-operator/blob/release-4.5/bindata/v4.1.0/config/defaultconfig.yaml#L47-L77
4. https://github.com/openshift/cluster-kube-apiserver-operator/blob/release-4.6/bindata/v4.1.0/config/defaultconfig.yaml#L34-L78
5. https://github.com/k8scop/k8s-security-dashboard/blob/master/configs/kubernetes/adv-audit.yaml
6. https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/
7. https://github.com/falcosecurity/falco/blob/master/examples/k8s_audit_config/audit-policy.yaml
8. https://github.com/kubernetes/kubernetes/blob/master/cluster/gce/gci/configure-helper.sh#L735

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 8.5 Collect Detailed Audit Logs | | X | X |
| v7 | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data | | | X |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1543 | TA0003, TA0004 | M1026 |

## Profile
**Level 2** (Manual)
