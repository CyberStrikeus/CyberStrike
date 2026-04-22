---
name: cis-k8s-v1120-4.1.10
description: "If the kubelet config.yaml configuration file is being used validate file ownership is set to root:root (Automated)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, worker-nodes, worker-node-config, file-permissions]
cis_id: "4.1.10"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Kubernetes Benchmark v1.12.0 - Control 4.1.10

## Description

Ensure that if the kubelet refers to a configuration file with the `--config` argument, that file is owned by root:root.

## Rationale

The kubelet reads various parameters, including security settings, from a config file specified by the `--config` argument. If this file is specified you should restrict its file permissions to maintain the integrity of the file. The file should be owned by root:root.

## Impact

None

## Audit Procedure

### Step 1: Set the kubelet config yaml variable

Automated AAC auditing has been modified to allow CIS-CAT to input a variable for the `<PATH>/<FILENAME>` of the kubelet config yaml file.

Please set `$kubelet_config_yaml=<PATH>` based on the file location on your system.

For example:

```bash
export kubelet_config_yaml=/var/lib/kubelet/config.yaml
```

### Step 2: Verify file ownership

To perform the audit manually: Run the below command (based on the file location on your system) on the each worker node. For example,

```bash
stat -c %U:%G /var/lib/kubelet/config.yaml
```

Verify that the ownership is set to `root:root`.

## Remediation

Run the following command (using the config file location identified in the Audit step):

```bash
chown root:root /etc/kubernetes/kubelet.conf
```

## Default Value

By default, `/var/lib/kubelet/config.yaml` file as set up by `kubeadm` is owned by `root:root`.

## References

1. https://kubernetes.io/docs/tasks/administer-cluster/kubelet-config-file/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts<br>Restrict administrator privileges to dedicated administrator accounts on enterprise assets. | | ● | ● |
| v7 | 4 Controlled Use of Administrative Privileges<br>Controlled Use of Administrative Privileges | | | |

## Profile Applicability

- Level 1 - Worker Node

## Assessment Status

Automated
