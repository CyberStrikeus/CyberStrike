---
name: cis-k8s-v1110-4.1.9
description: "If the kubelet config.yaml configuration file is being used validate permissions set to 600 or more restrictive (Automated)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, worker-node, config-files, file-permissions, kubelet-config-yaml]
cis_id: "4.1.9"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.9 If the kubelet config.yaml configuration file is being used validate permissions set to 600 or more restrictive (Automated)

## Profile Applicability

- Level 1 - Worker Node

## Description

Ensure that if the kubelet refers to a configuration file with the `--config` argument, that file has permissions of 600 or more restrictive.

## Rationale

The kubelet reads various parameters, including security settings, from a config file specified by the `--config` argument. If this file is specified you should restrict its file permissions to maintain the integrity of the file. The file should be writable by only the administrators on the system.

## Impact

None

## Audit

Automated AAC auditing has been modified to allow CIS-CAT to input a variable for the `<PATH>/<FILENAME>` of the kubelet config yaml file.
Please set `$kubelet_config_yaml=<PATH>` based on the file location on your system for example:

```bash
export kubelet_config_yaml=/var/lib/kubelet/config.yaml
```

To perform the audit manually:
Run the below command (based on the file location on your system) on the each worker node. For example,

```bash
stat -c %a /var/lib/kubelet/config.yaml
```

Verify that the permissions are `600` or more restrictive.

## Remediation

Run the following command (using the config file location identified in the Audit step)

```bash
chmod 600 /var/lib/kubelet/config.yaml
```

## Default Value

By default, the /var/lib/kubelet/config.yaml file as set up by `kubeadm` has permissions of 600.

## References

1. [https://kubernetes.io/docs/tasks/administer-cluster/kubelet-config-file/](https://kubernetes.io/docs/tasks/administer-cluster/kubelet-config-file/)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |
