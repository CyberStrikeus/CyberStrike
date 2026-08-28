---
name: cis-ocp-v180-4.2.1
description: "Activate Garbage collection in OpenShift Container Platform 4, as appropriate (Manual)"
category: cis-openshift
version: "1.8.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, worker-node, kubelet]
cis_id: "4.2.1"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.8.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.8.0 - Control 4.2.1

## Profile Applicability

- **Level:** 1

## Description

Configure garbage collection for containers and images as appropriate.

## Rationale

Garbage collection is important to ensure sufficient resource availability and avoiding degraded performance and availability. In the worst case, the system might crash or just be unusable for a long period of time. Based on your system resources and tests, choose an appropriate threshold value to activate garbage collection.

## Impact

Incorrect configuration of garbage collection parameters can lead to system instability, degraded performance, and in worst cases, system crashes. Properly set parameters ensure efficient utilization of system resources.

## Audit Procedure

Two types of garbage collection are performed on an OpenShift Container Platform node:

- Container garbage collection: Removes terminated containers.
- Image garbage collection: Removes images not referenced by any running pods.

Container garbage collection can be performed using eviction thresholds. Image garbage collection relies on disk usage as reported by cAdvisor on the node to decide which images to remove from the node. The OpenShift administrator can configure how OpenShift Container Platform performs garbage collection by creating a `kubeletConfig` object for each Machine Config Pool using any combination of the following:

- soft eviction, which evicts containers based on eviction settings and a grace period
- hard eviction, which evicts containers based on eviction settings without a grace period
- eviction for images

To configure, follow the directions in [Freeing Node Resources Using Garbage Collection](https://docs.openshift.com/container-platform/latest/nodes/nodes/nodes-nodes-garbage-collection.html).

To verify settings, run the following command for each updated `configpool`. To verify, you can inspect the configuration of each node individually:

```bash
for node in $(oc get nodes -ojsonpath='{.items[*].metadata.name}')
do
        oc get --raw /api/v1/nodes/$node/proxy/configz | jq '.kubeletconfig'
done
```

You can verify the values of the `evictionHard` settings. Verify the values for the following are set as appropriate:

- `evictionHard`
- `evictionPressureTransitionPeriod`
- `imageMinimumGCAge`
- `imageGCHighThresholdPercent`
- `imageGCLowThresholdPercent`
- `evictionSoft` (if configured)
- `evictionSoftGracePeriod` (if configured)

## Remediation

To configure, follow the directions in [Garbage Collection Remediation](https://docs.openshift.com/container-platform/latest/nodes/nodes/nodes-nodes-garbage-collection.html).

## Default Value

The kubelet has the following default hard eviction thresholds:

```json
{
  "imagefs.available": "15%",
  "memory.available": "100Mi",
  "nodefs.available": "10%",
  "nodefs.inodesFree": "5%"
}
```

Note: These default values of hard eviction thresholds will only be set if none of the parameters is changed. If you changed the value of any parameter, then the values of other parameters will not be inherited as the default values and will be set to zero. In order to provide custom values, you should provide all the thresholds respectively.

## References

1. https://docs.openshift.com/container-platform/latest/operators/operator-reference.html#cluster-openshift-controller-manager-operator_cluster-operators-ref
2. https://docs.openshift.com/container-platform/latest/operators/operator-reference.html#kube-controller-manager-operator_cluster-operators-ref
3. https://docs.openshift.com/container-platform/latest/nodes/nodes/nodes-nodes-garbage-collection.html
4. https://github.com/openshift/kubernetes-kubelet/blob/origin-4.5-kubernetes-1.18.3/config/v1beta1/types.go#L554-L604
5. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/
6. https://github.com/kubernetes/kubernetes/issues/28484

## CIS Controls

| Controls Version | Control                                | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------- | ---- | ---- | ---- |
| v8               | 10.5 Enable Anti-Exploitation Features |      | \*   | \*   |
| v7               | 5.1 Establish Secure Configurations    | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

This control does not have specific MITRE ATT&CK mappings.

## Profile

**Level 1** (Manual)
