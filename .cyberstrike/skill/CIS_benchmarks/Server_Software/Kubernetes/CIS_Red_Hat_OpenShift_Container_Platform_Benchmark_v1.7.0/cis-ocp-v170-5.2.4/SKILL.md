---
name: cis-ocp-v170-5.2.4
description: "Minimize admission of containers sharing host network namespace (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, security-context-constraints]
cis_id: "5.2.4"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 5.2.4

## Profile Applicability

- **Level:** 1

## Description

Do not generally permit containers to be run with the `hostNetwork` flag set to true.

## Rationale

A container running in the host's network namespace could access the local loopback device, and could access network traffic to and from other pods.

There should be at least one Security Context Constraint (SCC) defined which does not permit containers to share the host network namespace.

If you have need to run containers which require hostNetwork, this should be defined in a separate SCC and you should carefully check RBAC controls to ensure that only limited service accounts and users are given permission to access that SCC.

## Impact

Pods defined with `Allow Host Network: true` will not be permitted unless they are run under a specific SCC.

## Audit Procedure

Use the following command to list all SCCs with `allowHostNetwork` set to `false`:

```bash
oc get scc -A -o json | jq '.items[] | select(.allowHostNetwork==false) |
.metadata.name'
```

Verify at least one SCC is returned.

## Remediation

Create an SCC that sets `allowHostNetwork` to `false` and take it into use by assigning it to applicable users and groups.

## Default Value

By default, the following SCCs do not allow access to the host network:

```
"anyuid"
"hostmount-anyuid"
"nonroot"
"nonroot-v2"
"restricted"
"restricted-v2"
```

## References

1. https://docs.openshift.com/container-platform/latest/authentication/managing-security-context-constraints.html
2. https://kubernetes.io/docs/concepts/policy/pod-security-policy/

## CIS Controls

| Controls Version | Control                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.12 Segment Data Processing and Storage Based on Sensitivity |      | \*   | \*   |
| v7               | 14.1 Segment the Network Based on Sensitivity                 |      | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1098                       | TA0003  | M1030       |

## Profile

**Level 1** (Manual)
