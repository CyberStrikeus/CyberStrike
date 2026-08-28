---
name: cis-ocp-v160-5.2.8
description: "Minimize the admission of containers with added capabilities (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, security-context-constraints]
cis_id: "5.2.8"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 5.2.8

## Profile Applicability

- **Level:** 1

## Description

Do not generally permit containers with capabilities assigned beyond the default set.

## Rationale

Containers run with a default set of capabilities as assigned by the Container Runtime. Capabilities outside this set can be added to containers which could expose them to risks of container breakout attacks.

There should be at least one Security Context Constraint (SCC) defined which prevents containers with capabilities beyond the default set from launching.

If you need to run containers with additional capabilities, this should be defined in a separate SCC and you should carefully check RBAC controls to ensure that only limited service accounts and users are given permission to access that SCC.

## Impact

Pods with containers which require capabilities outside the default set will not be permitted.

## Audit Procedure

Use the following command to list all SCCs that prohibit users from defining container capabilities:

```bash
oc get scc -A -o json | jq '.items[] | select(.allowedCapabilities==null) |
.metadata.name'
```

Verify at least one SCC is returned.

Additionally, use the following command to list all SCCs that do not set default container capabilities:

```bash
oc get scc -A -o json | jq '.items[] | select(.defaultAddCapabilities==null)
| .metadata.name'
```

Verify at least one SCC is returned.

## Remediation

Utilize the restricted-v2 SCC or create an SCC that sets `allowedCapabilities` and `defaultAddCapabilities` to an empty list and take it into use by assigning it to applicable users and groups.

## Default Value

By default authenticated users are allowed to use the restricted-v2 SCC, which drops all container capabilities.

## References

1. https://docs.openshift.com/container-platform/latest/authentication/managing-security-context-constraints.html
2. https://kubernetes.io/docs/concepts/policy/pod-security-policy/#enabling-pod-security-policies
3. https://www.nccgroup.com/uk/our-research/abusing-privileged-and-unprivileged-linux-containers/

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | \*   | \*   |
| v7               | 5.2 Maintain Secure Images                                                      |      | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1204                       | TA0002, TA0003 | M1047       |

## Profile

**Level 1** (Manual)
