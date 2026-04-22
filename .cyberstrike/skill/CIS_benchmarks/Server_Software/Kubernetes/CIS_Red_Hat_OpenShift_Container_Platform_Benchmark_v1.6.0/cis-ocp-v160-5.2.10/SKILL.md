---
name: cis-ocp-v160-5.2.10
description: "Minimize access to privileged Security Context Constraints (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, security-context-constraints]
cis_id: "5.2.10"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 5.2.10

## Profile Applicability
- **Level:** 1

## Description
OpenShift has the concept of Security Context Constraints (SCCs) that supplement the Pod Security Admission controller.

SCCs allow you to group elevated container capabilities and assign those capabilities to users and groups. For example, you can have an SCC that restricts the ability to launch privileged containers and assign that SCC to all authenticated users. As a result, users requesting a pod that contains a privileged container will be rejected.

You can find more information on SCCs in the OpenShift documentation.

## Rationale
SCCs that contain the ability to permit privileged or elevated container action should be carefully managed. Users with access to such an SCC can leverage the privileged functionality granted by that SCC, increasing the risk of compromising the container or host.

## Impact
Users should only have access to SCCs that allow them to perform functions required by their roles, and no more, following the principle of least privilege.

## Audit Procedure
Find all users and groups with access to SCCs that include privileged or elevated capabilities:

```bash
oc get scc -ojson | jq '.items[]|select(.allowHostIPC or .allowHostPID or
.allowHostPorts or .allowHostNetwork or .allowHostDirVolumePlugin or
.allowPrivilegedContainer or .runAsUser.type != "MustRunAsRange"
)|.metadata.name,{"Group:":.groups},{"User:":.users}'
```

Review the returned users and groups and verify they actually need access to those SCCs.

## Remediation
Remove any users and groups who do not need access to an SCC, following the principle of least privilege.
You can remove users and groups from an SCC using the `oc edit scc $NAME` command.

Additionally, you can create your own SCCs that contain the container functionality you need for a particular use case and assign that SCC to users and groups if the default SCCs are not appropriate for your use case.

## Default Value
OpenShift provides the following SCCs by default:

```
"anyuid"
"hostaccess"
"hostmount-anyuid"
"hostnetwork"
"hostnetwork-v2"
"machine-api-termination-handler"
"node-exporter"
"nonroot"
"nonroot-v2"
"privileged"
"restricted"
"restricted-v2"
```

These default SCCs attempt to group similar privileged container functionality into a single SCC that fits particular use cases.

Please refer to the OpenShift documentation for a complete list of capabilities associated with each default SCC.

## References
1. https://docs.openshift.com/container-platform/latest/authentication/managing-security-context-constraints.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 6.8 Define and Maintain Role-Based Access Control | | | * |
| v7 | 4.7 Limit Access to Script Tools | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1078, T1078.002 | TA0001, TA0004 | M1026 |

## Profile
**Level 1** (Manual)
