---
name: cis-ocp-v190-4.2.7
description: "Ensure that the --make-iptables-util-chains argument is set to true (Manual)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, worker-nodes, kubelet]
cis_id: "4.2.7"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 4.2.7

## Profile Applicability

- **Level:** 1

## Description

Allow Kubelet to manage iptables.

## Rationale

Kubelets can automatically manage the required changes to iptables based on how you choose your networking options for the pods. It is recommended to let kubelets manage the changes to iptables. This ensures that the iptables configuration remains in sync with pods networking configuration. Manually configuring iptables with dynamic pod network configuration changes might hamper the communication between pods/containers and to the outside world. You might have iptables rules too restrictive or too open.

## Impact

Kubelet would manage the iptables on the system and keep it in sync. If you are using any other iptables management solution, then there might be some conflicts.

## Audit Procedure

Use the following command to ensure each node sets `makeIPTablesUtilChains` to `true`.

```bash
for node in $(oc get nodes -ojsonpath='{.items[*].metadata.name}'); do
oc get --raw /api/v1/nodes/$node/proxy/configz | jq '.kubeletconfig.makeIPTablesUtilChains'
done
```

Verify the output returned for each node is `true`.

## Remediation

None.

## Default Value

By default, the `makeIPTablesUtilChains` argument is set to `true`.

## References

1. https://docs.openshift.com/container-platform/latest/architecture/control-plane.html#understanding-machine-config-operator_control-plane
2. https://github.com/openshift/kubernetes-kubelet/blob/origin-4.5-kubernetes-1.18.3/config/v1beta1/types.go#L618-L626
3. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/

## CIS Controls

| Controls Version | Control                                                     | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers              | \*   | \*   | \*   |
| v7               | 14.7 Enforce Access Control to Data through Automated Tools |      |      | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |

## Profile

**Level 1** (Manual)
