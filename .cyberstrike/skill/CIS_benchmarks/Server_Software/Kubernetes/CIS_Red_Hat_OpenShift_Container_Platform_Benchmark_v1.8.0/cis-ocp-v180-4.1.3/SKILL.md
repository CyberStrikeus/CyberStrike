---
name: cis-ocp-v180-4.1.3
description: "If proxy kube proxy configuration file exists ensure permissions are set to 644 or more restrictive (Manual)"
category: cis-openshift
version: "1.8.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, worker-node, config-files]
cis_id: "4.1.3"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.8.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.8.0 - Control 4.1.3

## Profile Applicability

- **Level:** 1

## Description

If `kube-proxy` is running, and if it is using a file-based configuration file, ensure that the file has permissions of `644` or more restrictive.

## Rationale

The `kube-proxy` configuration file controls various parameters of the `kube-proxy` service in the worker node. You should restrict its file permissions to maintain the integrity of the file. The file should be writable by only the administrators on the system.

It is possible to run `kube-proxy` with the kubeconfig parameters configured as a Kubernetes ConfigMap instead of a file. In this case, there is no proxy kubeconfig file.

## Impact

None.

## Audit Procedure

In OpenShift 4, the `kube-proxy` runs within the `sdn` pods, which copies the `kubeconfig` from a configmap to the container at `/config/kube-proxy-config.yaml`, with `644` permissions.

Run the following command:

```bash
for i in $(oc get pods -n openshift-sdn -l app=sdn -oname)
do
    oc exec -n openshift-sdn $i -- \
      stat -Lc %a /config/kube-proxy-config.yaml
done
```

Verify that the `kube-proxy-config.yaml` file has permissions of `644`.

## Remediation

None.

## Default Value

By default, `kube-proxy` config file has permissions of `644`.

## References

1. https://docs.openshift.com/container-platform/latest/networking/openshift_sdn/configuring-kube-proxy.html
2. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-proxy/

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | \*   | \*   | \*   |
| v7               | 14.6 Protect Information through Access Control Lists | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1083, T1222                | TA0005, TA0007 | M1022       |

## Profile

**Level 1** (Manual)
