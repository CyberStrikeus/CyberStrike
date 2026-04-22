---
name: cis-ocp-v190-5.2.3
description: "Minimize the admission of containers wishing to share the host IPC namespace (Manual)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, security-context-constraints]
cis_id: "5.2.3"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 5.2.3

## Profile Applicability
- **Level:** 1

## Description
Do not generally permit containers to be run with the `hostIPC` flag set to true.

## Rationale
A container running in the host's IPC namespace can use IPC to interact with processes outside the container.

There should be at least one Security Context Constraint (SCC) defined which does not permit containers to share the host IPC namespace.

If you have a requirement to containers which require hostIPC, this should be defined in a separate SCC and you should carefully check RBAC controls to ensure that only limited service accounts and users are given permission to access that SCC.

## Impact
Pods defined with `Allow Host IPC: true` will not be permitted unless they are run under a specific SCC.

## Audit Procedure
Use the following command to list all SCCs with `allowHostIPC` set to `false`:

```bash
oc get scc -o json | jq '.items[] | select(.allowHostIPC==false) | .metadata.name'
```

Verify at least one SCC is returned.

## Remediation
Create an SCC that sets `allowHostIPC` to `false` and take it into use by assigning it to applicable users and groups.

## Default Value
By default, the following SCCs do not allow users to run within the host IPC namespace:

- "anyuid"
- "hostmount-anyuid"
- "hostnetwork"
- "hostnetwork-v2"
- "machine-api-termination-handler"
- "node-exporter"
- "nonroot"
- "nonroot-v2"
- "restricted"
- "restricted-v2"

## References
1. https://docs.openshift.com/container-platform/latest/authentication/managing-security-context-constraints.html
2. https://kubernetes.io/docs/concepts/policy/pod-security-policy/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 13.10 Perform Application Layer Filtering | | | x |
| v7 | 12.9 Deploy Application Layer Filtering Proxy Server | | | x |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1078, T1078.002 | TA0001, TA0004 | M1026 |

## Profile
**Level 1** (Manual)
