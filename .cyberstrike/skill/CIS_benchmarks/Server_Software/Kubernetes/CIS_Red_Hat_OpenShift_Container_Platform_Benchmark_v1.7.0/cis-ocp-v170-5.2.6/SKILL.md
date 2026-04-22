---
name: cis-ocp-v170-5.2.6
description: "Minimize admission of root containers (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, security-context-constraints]
cis_id: "5.2.6"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 5.2.6

## Profile Applicability
- **Level:** 2

## Description
Do not generally permit containers to be run as the root user.

## Rationale
Containers may run as any Linux user. Containers which run as the root user, whilst constrained by Container Runtime security features still have an escalated likelihood of container breakout.

Ideally, all containers should run as a defined non-UID 0 user.

There should be at least one Security Context Constraint (SCC) defined which does not permit root users in a container.

If you need to run root containers, this should be defined in a separate SCC and you should carefully check RBAC controls to ensure that only limited service accounts and users are given permission to access that SCC.

## Impact
Pods with containers which run as the root user will not be permitted.

## Audit Procedure
Use the following command to list all SCCs that restrict the ability to run the container as root:

```bash
oc get scc -A -o json | jq '.items[] | select(.runAsUser["type"] ==
"MustRunAsNonRoot") | .metadata.name'
```

Verify at least one SCC is returned.

You can perform additional validation by using the following command to list the UID range for each SCC:

```bash
for i in `oc get scc --template '{{range
.items}}{{.metadata.name}}{{"\n"}}{{end}}'`; do echo "$i"; oc describe scc $i
| grep "\sUID"; done
```

Verify there is at least one SCC that doesn't contain 0 in the UID range.

## Remediation
None required. By default, OpenShift includes the `nonroot` and `nonroot-v2` SCCs that restrict the ability to run as nonroot. If additional SCCs are appropriate, follow the OpenShift documentation to create custom SCCs.

## Default Value
By default, the following SCCs restrict the ability to run as non-root:

```
"nonroot"
"nonroot-v2"
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
| T1098 | TA0003 | M1026 |

## Profile
**Level 2** (Manual)
