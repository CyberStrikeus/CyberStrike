---
name: cis-ocp-v160-5.2.7
description: "Minimize the admission of containers with the NET_RAW capability (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, security-context-constraints]
cis_id: "5.2.7"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 5.2.7

## Profile Applicability
- **Level:** 1

## Description
Do not generally permit containers with the potentially dangerous NET_RAW capability.

## Rationale
Containers run with a default set of capabilities as assigned by the Container Runtime. By default this can include potentially dangerous capabilities. With Docker as the container runtime the `NET_RAW` capability is enabled which may be misused by malicious containers.

Ideally, all containers should drop this capability.

There should be at least one Security Context Constraint (SCC) defined which prevents containers with the `NET_RAW` capability from launching.

If you need to run containers with this capability, this should be defined in a separate SCC and you should carefully check RBAC controls to ensure that only limited service accounts and users are given permission to access that SCC.

## Impact
Pods with containers which run with the NET_RAW capability will not be permitted.

## Audit Procedure
Use the following command to list all SCCs that drop all capabilities:

```bash
oc get scc -A -o json | jq '.items[] |
select(.requiredDropCapabilities[]?|any(. == "ALL"; .)) | .metadata.name'
```

Verify at least one SCC is returned.

## Remediation
Create an SCC that sets `requiredDropCapabilities` to include `ALL` or at least `NET_RAW` and take it into use by assigning it to applicable users and groups.

## Default Value
By default, the following SCCs drop all capabilities:

```
"hostnetwork-v2"
"nonroot-v2"
"restricted-v2"
```

## References
1. https://docs.openshift.com/container-platform/latest/authentication/managing-security-context-constraints.html
2. https://kubernetes.io/docs/concepts/policy/pod-security-policy/#enabling-pod-security-policies
3. https://www.nccgroup.trust/uk/our-research/abusing-privileged-and-unprivileged-linux-containers/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | * | * |
| v7 | 5.2 Maintain Secure Images | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1068 | TA0004 | M1050 |

## Profile
**Level 1** (Manual)
