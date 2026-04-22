---
name: cis-ocp-v180-5.2.5
description: "Minimize admission of containers with allowPrivilegeEscalation (Manual)"
category: cis-openshift
version: "1.8.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, security-context-constraints]
cis_id: "5.2.5"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.8.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.8.0 - Control 5.2.5

## Profile Applicability
- **Level:** 1

## Description
Do not generally permit containers to be run with the `allowPrivilegeEscalation` flag set to `true`.

## Rationale
A container with the `allowPrivilegeEscalation` flag set to `true` may have processes that can gain more privileges than their parent.

There should be at least one Security Context Constraint (SCC) defined which does not permit containers to allow privilege escalation. The option exists (and is defaulted to true) to permit setuid binaries to run.

If you have need to run containers which use setuid binaries or require privilege escalation, this should be defined in a separate SCC and you should carefully check RBAC controls to ensure that only limited service accounts and users are given permission to access that SCC.

## Impact
Pods defined with `Allow Privilege Escalation: true` will not be permitted unless they are run under a specific SCC.

## Audit Procedure
Use the following command to list all SCCs with `allowPrivilegeEscalation` set to `false`:

```bash
oc get scc -A -o json | jq '.items[] |
select(.allowPrivilegeEscalation==false) | .metadata.name'
```

Verify that there is at least one SCC returned.

## Remediation
Create an SCC that sets `allowPrivilegeEscalation` to `false` and take it into use by assigning it to applicable users and groups.

## Default Value
By default, the following SCCs do not allow privilege escalation:

```
"hostnetwork-v2"
"nonroot-v2"
"restricted-v2"
```

## References
1. https://docs.openshift.com/container-platform/latest/authentication/managing-security-context-constraints.html
2. https://kubernetes.io/docs/concepts/policy/pod-security-policy/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | * | * | * |
| v8 | 12.8 Establish and Maintain Dedicated Computing Resources for All Administrative Work | | | * |
| v7 | 4.3 Ensure the Use of Dedicated Administrative Accounts | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1611 | TA0004 | M1038, M1048 |

## Profile
**Level 1** (Manual)
