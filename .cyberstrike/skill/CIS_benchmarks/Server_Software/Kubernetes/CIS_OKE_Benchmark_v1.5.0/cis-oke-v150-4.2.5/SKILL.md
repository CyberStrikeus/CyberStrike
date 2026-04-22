---
name: cis-oke-v150-4.2.5
description: "Minimize the admission of containers with allowPrivilegeEscalation (Automated)"
category: cis-oke
version: "1.5.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, pod-security]
cis_id: "4.2.5"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.5.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.5 Minimize the admission of containers with allowPrivilegeEscalation (Automated)

## Profile Applicability

- Level 1

## Description

Do not generally permit containers to be run with the `allowPrivilegeEscalation` flag set to `true`. Allowing this right can lead to a process running a container getting more rights than it started with.

It's important to note that these rights are still constrained by the overall container sandbox, and this setting does not relate to the use of privileged containers.

## Rationale

A container running with the `allowPrivilegeEscalation` flag set to `true` may have processes that can gain more privileges than their parent.

There should be at least one admission control policy defined which does not permit containers to allow privilege escalation. The option exists (and is defaulted to true) to permit setuid binaries to run.

If you have need to run containers which use setuid binaries or require privilege escalation, this should be defined in a separate policy and you should carefully check to ensure that only limited service accounts and users are given permission to use that policy.

## Impact

Pods defined with `spec.allowPrivilegeEscalation: true` will not be permitted unless they are run under a specific policy.

## Audit Procedure

List the policies in use for each namespace in the cluster, ensure that each policy disallows the admission of containers which allow privilege escalation.

This command gets all pods across all namespaces, outputs their details in JSON format, and uses jq to parse and filter the output for containers with `allowPrivilegeEscalation` set to `true`.

```bash
kubectl get pods --all-namespaces -o json | jq -r '.items[] | select(any(.spec.containers[]; .securityContext.allowPrivilegeEscalation == true)) | "\(.metadata.namespace)/\(.metadata.name)"'
```

OR

```bash
kubectl get pods --all-namespaces -o json | jq '.items[] | select(.metadata.namespace != "kube-system" and .spec.containers[]; .securityContext.allowPrivilegeEscalation == true) | {pod: .metadata.name, namespace: .metadata.namespace, container: .spec.containers[].name}'
```

When creating a Pod Security Policy, ["kube-system"] namespaces are excluded by default. This command uses jq, a command-line JSON processor, to parse the JSON output from kubectl get pods and filter out pods where any container has the securityContext.privileged flag set to true. Please note that you might need to adjust the command depending on your specific requirements and the structure of your pod specifications.

## Remediation

Add policies to each namespace in the cluster which has user workloads to restrict the admission of containers with `.spec.allowPrivilegeEscalation` set to `true`.

## Default Value

By default, there are no restrictions on contained process ability to escalate privileges, within the context of the container.

## References

1. [https://kubernetes.io/docs/concepts/security/pod-security-admission/](https://kubernetes.io/docs/concepts/security/pod-security-admission/)
2. [https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm](https://docs.cloud.oracle.com/en-us/iaas/Content/ContEng/Concepts/contengoverview.htm)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | X | X | X |
| v7 | 5.1 Establish Secure Configurations | X | X | X |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1611 | TA0004 | M1038, M1048 |

---

**Profile:** Level 1
