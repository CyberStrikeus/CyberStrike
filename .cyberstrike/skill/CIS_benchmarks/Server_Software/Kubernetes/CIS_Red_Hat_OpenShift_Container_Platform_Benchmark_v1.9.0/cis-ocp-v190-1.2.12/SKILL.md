---
name: cis-ocp-v190-1.2.12
description: "Ensure that the admission control plugin SecurityContextConstraint is set (Manual)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server, admission-control, security-context-constraint, scc]
cis_id: "1.2.12"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 1.2.12

## Profile Applicability
- **Level:** 1

## Description
Reject creating pods that do not match Pod Security Policies.

## Rationale
A Pod Security Policy is a cluster-level resource that controls the actions that a pod can perform and what it has the ability to access. The `PodSecurityPolicy` objects define a set of conditions that a pod must run with in order to be accepted into the system. Pod Security Policies are composed of settings and strategies that control the security features a pod has access to and hence this must be used to control pod access permissions.

Note: When the `PodSecurityPolicy` admission plugin is in use, there needs to be at least one `PodSecurityPolicy` in place for ANY pods to be admitted. See section 5.2 for recommendations on `PodSecurityPolicy` settings.

## Impact
Default Security Context Constraint objects are present on the cluster and granted by default based on roles. Custom SCCs can be created and granted as needed.

## Audit Procedure
OpenShift provides the same protection via the SecurityContextConstraints admission plugin, which is enabled by default. The `PodSecurityPolicy` admission control plugin is disabled by default as it is still beta and not yet supported with OpenShift. Security Context Constraints (SCCs) and Pod Security Policy cannot be used on the same cluster.

Use the following command to obtain a list of configured admission controllers:

```bash
oc -n openshift-kube-apiserver get configmap config -o json | jq -r '.data."config.yaml"' | jq '.apiServerArguments."enable-admission-plugins"'
```

Verify that `security.openshift.io/SecurityContextConstraint` is returned in the list.

## Remediation
None.

## Default Value
By default, the `SecurityContextConstraints` admission controller is configured and cannot be disabled.

## References
1. https://docs.openshift.com/container-platform/latest/authentication/managing-security-context-constraints.html
2. https://docs.openshift.com/container-platform/latest/architecture/admission-plug-ins.html
3. https://github.com/openshift/cluster-kube-apiserver-operator/blob/release-4.6/bindata/v4.1.0/config/defaultconfig.yaml#L34-L78
4. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
5. https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/#podsecuritypolicy
6. https://kubernetes.io/docs/concepts/policy/pod-security-policy/#enabling-pod-security-policies

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 16.11 Leverage Vetted Modules or Services for Application Security Components | | * | * |
| v7 | 9.4 Apply Host-based Firewalls or Port Filtering | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1610 | TA0002 | M1038, M1050 |

## Profile
**Level 1** (Manual)
