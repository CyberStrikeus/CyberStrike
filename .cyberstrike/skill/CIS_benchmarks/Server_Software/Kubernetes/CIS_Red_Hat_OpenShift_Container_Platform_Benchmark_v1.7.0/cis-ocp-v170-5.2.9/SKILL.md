---
name: cis-ocp-v170-5.2.9
description: "Minimize admission of containers with capabilities assigned (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, policies, security-context-constraints]
cis_id: "5.2.9"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 5.2.9

## Profile Applicability
- **Level:** 2

## Description
Do not generally permit containers with capabilities.

## Rationale
Containers run with a default set of capabilities as assigned by the Container Runtime. Capabilities are parts of the rights generally granted on a Linux system to the root user.

In many cases applications running in containers do not require any capabilities to operate, so from the perspective of the principal of least privilege use of capabilities should be minimized.

## Impact
Pods with containers which require capabilities to operate will not be permitted.

## Audit Procedure
Use the following command to list SCCs that drop all capabilities from containers:

```bash
oc get scc -A -o json | jq '.items[] |
select(.requiredDropCapabilities[]?|any(. == "ALL"; .)) | .metadata.name'
```

Verify at least one SCC is returned.

## Remediation
Review the use of capabilities in applications running on your cluster. Where a namespace contains applications which do not require any Linux capabilities to operate, consider adding a SCC which forbids the admission of containers which do not drop all capabilities.

## Default Value
By default, OpenShift includes three SCCs that drop all container capabilities:

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
|-----------------|---------|------|------|------|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | * | * |
| v7 | 5.2 Maintain Secure Images | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1204 | TA0002, TA0003 | M1045, M1047 |

## Profile
**Level 2** (Manual)
