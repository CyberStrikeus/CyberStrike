---
name: cis-oke-v180-4.2.1
description: "Minimize the admission of privileged containers (Automated)"
category: cis-oke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, policies, pod-security]
cis_id: "4.2.1"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.2.1 Minimize the admission of privileged containers (Automated)

## Profile Applicability

- Level 1

## Description

Do not generally permit containers to be run with the `securityContext.privileged` flag set to `true`.

## Rationale

Privileged containers have access to all Linux Kernel capabilities and devices. A container running with full privileges can do almost everything that the host can do. This flag exists to allow special use-cases, like manipulating the network stack and accessing devices.

There should be at least one admission control policy defined which does not permit privileged containers.

If you need to run privileged containers, this should be defined in a separate policy and you should carefully check to ensure that only limited service accounts and users are given permission to use that policy.

## Impact

Pods defined with `spec.containers[].securityContext.privileged: true`, `spec.initContainers[].securityContext.privileged: true` and `spec.ephemeralContainers[].securityContext.privileged: true` will not be permitted.

## Audit

List the policies in use for each namespace in the cluster, ensure that each policy disallows the admission of privileged containers.

Since manually searching through each pod's configuration might be tedious, especially in environments with many pods, you can use a more automated approach with grep or other command-line tools.

```bash
kubectl get pods -A -o json \
| jq -r '
  .items[]
  | .metadata.namespace as $ns
  | .metadata.name as $pod
  | .spec.containers[]? as $c
  | select(($c.securityContext.privileged // false) == true)
  | "\($ns)/\($pod)\tcontainer=\($c.name)\tprivileged=true"
'
```

OR

```bash
kubectl get pods --all-namespaces -o json | jq '.items[] |
select(.metadata.namespace != "kube-system" and
.spec.containers[]?.securityContext?.privileged == true) | {pod:
.metadata.name, namespace: .metadata.namespace, container:
.spec.containers[].name}'
```

When creating a Pod Security Policy, ["kube-system"] namespaces are excluded by default.

## Remediation

Add policies to each namespace in the cluster which has user workloads to restrict the admission of privileged containers.

To enable PSA for a namespace in your cluster, set the pod-security.kubernetes.io/enforce label with the policy value you want to enforce.

```bash
kubectl label --overwrite ns NAMESPACE pod-security.kubernetes.io/enforce=restricted
```

The above command enforces the restricted policy for the NAMESPACE namespace.

You can also enable Pod Security Admission for all your namespaces. For example:

```bash
kubectl label --overwrite ns --all pod-security.kubernetes.io/warn=baseline
```

## Default Value

By default, there are no restrictions on the creation of privileged containers.

## References

1. https://kubernetes.io/docs/concepts/security/pod-security-admission/

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | x    | x    | x    |
| v7               | 5.1 Establish Secure Configurations                                       | x    | x    | x    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations  |
| --------------------------- | ------- | ------------ |
| T1611                       | TA0004  | M1038, M1048 |
