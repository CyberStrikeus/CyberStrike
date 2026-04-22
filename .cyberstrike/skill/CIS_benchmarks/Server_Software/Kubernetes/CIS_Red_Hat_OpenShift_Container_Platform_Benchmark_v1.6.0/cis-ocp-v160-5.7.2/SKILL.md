---
name: cis-ocp-v160-5.7.2
description: "Ensure that the seccomp profile is set to docker/default in your pod definitions (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, general-policies]
cis_id: "5.7.2"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 5.7.2

## Profile Applicability
- **Level:** 2

## Description
Enable `default` seccomp profile in your pod definitions.

## Rationale
Seccomp (secure computing mode) is used to restrict the set of system calls applications can make, allowing cluster administrators greater control over the security of workloads running in the cluster. Kubernetes disables seccomp profiles by default for historical reasons. You should enable it to ensure that the workloads have restricted actions available within the container.

## Impact
If the `default` seccomp profile is too restrictive for you, you will need to create and manage your own seccomp profiles, which can be done using OpenShift Security Context Constraints and custom seccomp profiles.

## Audit Procedure
In OpenShift 4, CRI-O is the supported runtime. CRI-O runs unconfined by default in order to meet CRI conformance criteria.

On Red Hat CoreOS, the default seccomp policy is associated with CRI-O and stored in `/etc/crio/seccomp.json`. The default profile is applied when the user asks for the `RuntimeDefault` profile via annotation to the pod and when the associated SCC allows use of the specified seccomp profile.

Use the following command to find all non-default pods that do not have a seccomp profile set:

```bash
oc get pods -A -o json | jq '.items[] | select( (.metadata.namespace |
test("^kube*|^openshift*") | not) and
.spec.securityContext.seccompProfile.type==null) | (.metadata.namespace + "/"
+ .metadata.name)'
```

The output will return a list of namespace pod pairs that do not have a seccomp profile set.

## Remediation
For any non-privileged pods or containers that do not have seccomp profiles, consider using the `RuntimeDefault` or creating a custom seccomp profile specifically for the workload.

Please refer to the OpenShift documentation for working with custom seccomp profiles.

## Default Value
By default, OpenShift applies the `restricted-v2` SCC to all pods, which uses the `RuntimeDefault` seccomp profile.

## References
1. https://docs.openshift.com/container-platform/latest/authentication/managing-security-context-constraints.html
2. https://github.com/kubernetes/kubernetes/issues/39845
3. https://github.com/kubernetes/kubernetes/pull/21790
4. https://github.com/kubernetes/community/blob/master/contributors/design-proposals/seccomp.md#examples
5. https://docs.docker.com/engine/security/seccomp/
6. https://docs.openshift.com/container-platform/latest/security/seccomp-profiles.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process | * | * | * |
| v7 | 5.2 Maintain Secure Images | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1611 | TA0004 | M1048 |

## Profile
**Level 2** (Manual)
