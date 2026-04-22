---
name: cis-oke-v170-3.2.4
description: "Ensure that the --read-only-port argument is set to 0 (Automated)"
category: cis-oke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, oke, kubernetes, oci, worker-node, kubelet]
cis_id: "3.2.4"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.7.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS OKE Benchmark v1.7.0 - Control 3.2.4

## Profile Applicability

- **Level:** 1

## Description

Disable the read-only port.

## Rationale

The Kubelet process provides a read-only API in addition to the main Kubelet API. Unauthenticated access is provided to this read-only API which could possibly retrieve potentially sensitive information about the cluster.

## Impact

Removal of the read-only port will require that any service which made use of it will need to be re-configured to use the main Kubelet API.

## Audit Procedure

If using a Kubelet configuration file, check that there is an entry for `--read-only-port=0`.

First, SSH to the relevant node.

Run the following command on each node to find the appropriate Kubelet service config file:

```bash
find / -name kubelet.service
```

The output of the above command should return the file and location `/etc/systemd/system/kublet.service` which is the location of the Kubelet service config file.

Open the Kubelet service config file:

```bash
sudo more etc/systemd/system/kublet.service
```

Verify that the `--read-only-port` argument exists and is set to `0`.

If the `--read-only-port` argument is not present, check that there is a Kubelet config file specified by `--config`. Check that if there is a `readOnlyPort` entry in the file, it is set to `0`.

## Remediation

If modifying the Kubelet config file, edit the kubelet.service file `/etc/sytemd/system/kubelet.service` and set the below parameter:

```
--read-only-port=0
```

For all remediations: Based on your system, restart the `kubelet` service and check status

```bash
systemctl daemon-reload
systemctl restart kubelet.service
systemctl status kubelet -l
```

## Default Value

See the OKE documentation for the default value.

## References

1. https://kubernetes.io/docs/admin/kubelet/

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | \*   | \*   |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations  |
| --------------------------- | -------------- | ------------ |
| T1133                       | TA0001, TA0003 | M1030, M1035 |

## Profile

**Level 1** (Automated)
