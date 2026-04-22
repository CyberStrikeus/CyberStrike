---
name: cis-ocp-v160-5.7.3
description: "Apply Security Context to Your Pods and Containers (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, general-policies]
cis_id: "5.7.3"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 5.7.3

## Profile Applicability

- **Level:** 2

## Description

Apply Security Context to Your Pods and Containers.

## Rationale

A security context defines the operating system security settings (uid, gid, capabilities, SELinux role, etc..) applied to a container. When designing your containers and pods, make sure that you configure the security context for your pods, containers, and volumes. A security context is a property defined in the deployment yaml. It controls the security parameters that will be assigned to the pod/container/volume. There are two levels of security context: pod level security context, and container level security context.

## Impact

If you incorrectly apply security contexts, you may have trouble running the pods.

## Audit Procedure

Review the pod definitions in your cluster and verify that you have security contexts defined as appropriate.

OpenShift's Security Context Constraint feature is on by default in OpenShift 4 and applied to all pods deployed. SCC selection is determined by a combination of the values in the securityContext and the rolebindings for the account deploying the pod.

Run the following command to obtain a list of pods that are using `privileged` security context constraints:

```bash
oc get pods -A -o json | jq '.items[] |
select(.metadata.annotations."openshift.io/scc"|test("privileged"?)) |
.metadata.name'
```

Review each pod to ensure it requires the use of `privileged` security context constraints, which is the most relaxed security context constraint available in OpenShift by default.

Run the following command to obtain a list of pods that are not using security context constraints at all:

```bash
oc get pods -A -o json | jq '.items[] |
select(.metadata.annotations."openshift.io/scc" == null) | .metadata.name'
```

Review each pod and determine if there is an existing security context constraint that it should be using.

## Remediation

Follow the Kubernetes documentation and apply security contexts to your pods. For a suggested list of security contexts, you may refer to the CIS Security Benchmark for Docker Containers.

## Default Value

By default, no security contexts are automatically applied to pods.

## References

1. https://kubernetes.io/docs/concepts/policy/security-context/
2. https://learn.cisecurity.org/benchmarks

## CIS Controls

| Controls Version | Control                                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 7.3 Perform Automated Operating System Patch Management                                   | \*   | \*   | \*   |
| v7               | 8.3 Enable Operating System Anti-Exploitation Features / Deploy Anti-Exploit Technologies |      | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1556, T1611                | TA0004, TA0006 | M1048       |

## Profile

**Level 2** (Manual)
