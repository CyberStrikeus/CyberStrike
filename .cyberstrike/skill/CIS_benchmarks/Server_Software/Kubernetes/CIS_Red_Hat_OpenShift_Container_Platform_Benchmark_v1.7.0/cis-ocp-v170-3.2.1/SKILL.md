---
name: cis-ocp-v170-3.2.1
description: "Ensure minimal audit policy created (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane-config, logging]
cis_id: "3.2.1"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 3.2.1

## Profile Applicability
- **Level:** 1

## Description
Kubernetes can audit the details of requests made to the API server.

## Rationale
Logging is an important detective control for all systems, to detect potential unauthorized access.

## Impact
Audit logs will be created on the master nodes, which will consume disk space. Care should be taken to avoid generating too large volumes of log information as this could impact the available of the cluster nodes.

## Audit Procedure

In OpenShift, auditing of the API Server is on by default. Audit provides a security-relevant chronological set of records documenting the sequence of activities that have affected the system by individual users, administrators, or other components of the system. Audit works at the API server level, logging all requests coming to the server.

Each audit log contains two entries:
1. The request line containing:
   - A Unique ID allowing to match the response line (see #2)
   - The source IP of the request
   - The HTTP method being invoked
   - The original user invoking the operation
   - The impersonated user for the operation (self meaning himself)
   - The impersonated group for the operation (lookup meaning user's group)
   - The namespace of the request or
   - The URI as requested

2. The response line containing:
   - The unique ID from #1
   - The response code

You can view logs for the OpenShift Container Platform API server or the Kubernetes API server for each master node.

Use the following command to view the audit log profile:

```bash
oc get apiserver cluster -o json | jq .spec.audit.profile
```

Verify the result is not `None`, which means audit logging is disabled.

Review the audit log configuration for the OpenShift and Kubernetes API servers using the following commands:

```bash
oc get cm -n openshift-apiserver config -o json | jq -r '.data."config.yaml"' | jq .apiServerArguments
oc get cm -n openshift-kube-apiserver config -o json | jq -r '.data."config.yaml"' | jq .apiServerArguments
```

Review the audit policies for the OpenShift and Kubernetes API servers using the following commands:

```bash
oc get cm -n openshift-apiserver audit -o json | jq -r '.data."policy.yaml"'
oc get cm -n openshift-kube-apiserver kube-apiserver-audit-policies -o json | jq -r '.data."policy.yaml"'
```

Verify the returned configuration and ensure it aligns with data retention and storage requirements for the deployment.

Use the following command to view Kubernetes API server audit logs:

```bash
oc adm node-logs --role=master --path=kube-apiserver/
```

Verify logs are returned.

Use the following command to view OpenShift API server audit logs:

```bash
oc adm node-logs --role=master --path=openshift-apiserver/
```

Verify logs are returned.

## Remediation
None.

## Default Value
Auditing logging is enabled by default, using the `Default` audit profile.

Please reference the OpenShift audit logging [documentation](https://docs.openshift.com/container-platform/latest/security/audit-log-policy-config.html) for more information on various profiles and configuration guidance.

## References
1. https://docs.openshift.com/container-platform/latest/security/audit-log-policy-config.html
2. https://github.com/openshift/cluster-kube-apiserver-operator/blob/master/bindata/v4.1.0/config/defaultconfig.yaml#L17-L31
3. https://kubernetes.io/docs/tasks/debug-application-cluster/audit/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs | * | * | * |
| v7 | 6.2 Activate audit logging | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1543 | TA0003, TA0004 | M1026 |

## Profile
**Level 1** (Manual)
