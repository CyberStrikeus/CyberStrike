---
name: cis-ocp-v170-5.2.1
description: "Minimize admission of privileged containers (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, security-context-constraints]
cis_id: "5.2.1"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 5.2.1

## Profile Applicability

- **Level:** 1

## Description

Do not generally permit containers to be run with the `securityContext.privileged` flag set to `true`.

## Rationale

Privileged containers have access to all Linux Kernel capabilities and devices. A container running with full privileges can do almost everything that the host can do. This flag exists to allow special use-cases, like manipulating the network stack and accessing devices.

There should be at least one Security Context Constraint (SCC) defined which does not permit privileged containers.

If you need to run privileged containers, this should be defined in a separate SCC and you should carefully check RBAC controls to ensure that only limited service accounts and users are given permission to access that SCC.

## Impact

Pods defined with `spec.containers[].securityContext.privileged: true` will not be permitted.

## Audit Procedure

The set of SCCs that admission uses to authorize a pod are determined by the user identity and groups that the user belongs to. Additionally, if the pod specifies a service account, the set of allowable SCCs includes any constraints accessible to the service account.

Admission uses the following approach to create the final security context for the pod:

- Retrieve all SCCs available for use.
- Generate field values for security context settings that were not specified on the request.
- Validate the final settings against the available constraints.

If a matching set of constraints is found, then the pod is accepted. If the request cannot be matched to an SCC, the pod is rejected. A pod must validate every field against the SCC.

You can use the following command to list all SCCs that do not allow privileged containers:

```bash
oc get scc -o json | jq  '.items[] | select(.allowPrivilegedContainer==false)
| .metadata.name'
```

Verify that at least one SCC is returned.

## Remediation

Create an SCC that sets `allowPrivilegedContainer` to `false` and take it into use by assigning it to applicable users and groups.

## Default Value

By default, the following SCCs do not allow users to create privileged containers:

```
"anyuid"
"hostaccess"
"hostmount-anyuid"
"hostnetwork"
"hostnetwork-v2"
"machine-api-termination-handler"
"nonroot"
"nonroot-v2"
"restricted"
"restricted-v2"
```

## References

1. https://docs.openshift.com/container-platform/latest/authentication/managing-security-context-constraints.html
2. https://kubernetes.io/docs/concepts/policy/pod-security-policy/#enabling-pod-security-policies

## CIS Controls

| Controls Version | Control                                                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts             | \*   | \*   | \*   |
| v8               | 12.8 Establish and Maintain Dedicated Computing Resources for All Administrative Work |      |      | \*   |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts                               | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1611                       | TA0004  | M1048       |

## Profile

**Level 1** (Manual)
