---
name: cis-ocp-v160-1.3.5
description: "Ensure that the --bind-address argument is set to 127.0.0.1 (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, controller-manager, bind-address, network-security]
cis_id: "1.3.5"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 1.3.5

## Profile Applicability
- **Level:** 1

## Description
Do not bind the Controller Manager service to non-loopback insecure addresses.

## Rationale
The Controller Manager API service which runs on port 10257/TCP by default is used for health and metrics information and is available without authentication or encryption. As such it should only be bound to a localhost interface, to minimize the cluster's attack surface.

## Impact
None.

## Audit Procedure
The `bind-address` argument is not used. The `secure-port` argument is set to `10257`. The `insecure-port` argument is set to `0`.

Use the following command to check the secure port configuration:

```bash
oc get configmaps config -n openshift-kube-controller-manager -ojson | jq -r '.data["config.yaml"]' | jq '.extendedArguments["secure-port"][]'
```

Verify the returned value is `10257`.

Ensure the metrics endpoint is protected from unauthorized access:

```bash
export POD=$(oc get pods -n openshift-kube-controller-manager -l app=kube-controller-manager -o jsonpath='{.items[0].metadata.name}')
oc rsh -n openshift-kube-controller-manager -c kube-controller-manager $POD curl https://localhost:10257/metrics -k
```

Verify an HTTP 403 response is returned and unset environment variables:

```bash
unset POD
```

## Remediation
None.

## Default Value
By default, the `--bind-address` argument is not present, the `secure-port` argument is set to `10257` and the `port` argument is set to `0`.

## References
1. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#cluster-openshift-controller-manager-operator_red-hat-operators
2. https://docs.openshift.com/container-platform/4.5/operators/operator-reference.html#kube-controller-manager-operator_red-hat-operators
3. https://github.com/openshift/cluster-kube-controller-manager-operator
4. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 12.6 Use of Secure Network Management and Communication Protocols | | X | X |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | X | X |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1106 | TA0002 | M1035 |

## Profile
**Level 1** (Manual)
