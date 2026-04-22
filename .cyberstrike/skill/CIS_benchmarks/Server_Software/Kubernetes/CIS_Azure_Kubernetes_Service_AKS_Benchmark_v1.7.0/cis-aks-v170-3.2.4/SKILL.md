---
name: cis-aks-v170-3.2.4
description: "Ensure that the --read-only-port is secured (Automated)"
category: cis-aks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, kubelet, read-only-port, network-security]
cis_id: "3.2.4"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.7.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.2.4 Ensure that the --read-only-port is secured (Automated)

## Profile Applicability

- Level 1

## Description

Disable the read-only port.

## Rationale

The Kubelet process provides a read-only API in addition to the main Kubelet API. Unauthenticated access is provided to this read-only API which could possibly retrieve potentially sensitive information about the cluster.

## Impact

Removal of the read-only port will require that any service which made use of it will need to be re-configured to use the main Kubelet API.

## Audit Procedure

If using a Kubelet configuration file, check that there is an entry for `authentication: anonymous: enabled` set to `0`.

First, SSH to the relevant node:

Run the following command on each node to find the appropriate Kubelet config file:

```bash
ps -ef | grep kubelet
```

The output of the above command should return something similar to `--config /etc/kubernetes/kubelet/kubelet-config.json` which is the location of the Kubelet config file.

Open the Kubelet config file:

```bash
cat /etc/kubernetes/kubelet/kubelet-config.json
```

Verify that the `--read-only-port` argument exists and is set to `0`.

If the `--read-only-port` argument is not present, check that there is a Kubelet config file specified by `--config`. Check that if there is a `readOnlyPort` entry in the file, it is set to `0`.

## Remediation

If modifying the Kubelet config file, edit the kubelet-config.json file `/etc/kubernetes/kubelet/kubelet-config.json` and set the below parameter to false:

```json
readOnlyPort to 0
```

If using executable arguments, edit the kubelet service file `/etc/systemd/system/kubelet.service.d/10-kubelet-args.conf` on each worker node and add the below parameter at the end of the `KUBELET_ARGS` variable string.

```
--read-only-port=0
```

For all remediations: Based on your system, restart the `kubelet` service and check status:

```bash
systemctl daemon-reload
systemctl restart kubelet.service
systemctl status kubelet -l
```

## Default Value

See the Azure AKS documentation for the default value.

## References

1. https://kubernetes.io/docs/admin/kubelet/
2. https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-posture-vulnerability-management#pv-3-establish-secure-configurations-for-compute-resources

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4.1 Establish and Maintain a Secure Configuration Process | X | X | X |
| v8 | 4.4 Implement and Manage a Firewall on Servers | X | X | X |
| v8 | 4.5 Implement and Manage a Firewall on End-User Devices | X | X | X |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | X | X |
