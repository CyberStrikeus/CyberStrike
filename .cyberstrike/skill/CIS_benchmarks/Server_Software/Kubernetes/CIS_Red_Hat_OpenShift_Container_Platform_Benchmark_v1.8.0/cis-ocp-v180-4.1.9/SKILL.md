---
name: cis-ocp-v180-4.1.9
description: "Ensure that the kubelet --config configuration file has permissions set to 600 or more restrictive (Automated)"
category: cis-openshift
version: "1.8.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, worker-node, config-files]
cis_id: "4.1.9"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.8.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.8.0 - Control 4.1.9

## Profile Applicability
- **Level:** 1

## Description
Ensure that if the kubelet refers to a configuration file with the `--config` argument, that file has permissions of `600` or more restrictive.

## Rationale
The kubelet reads various parameters, including security settings, from a config file specified by the `--config` argument. If this file is specified you should restrict its file permissions to maintain the integrity of the file. The file should be writable by only the administrators on the system.

## Impact
None

## Audit Procedure

In OpenShift 4, the kubelet configuration file is managed by the Machine Config Operator.

Run the following command to check the permission:

```bash
for node in $(oc get nodes -o jsonpath='{.items[*].metadata.name}')
do
oc debug node/${node} -- chroot /host stat -c %a
/var/data/kubelet/config.json
done
```

OR

```bash
for node in $(oc get nodes -o jsonpath='{.items[*].metadata.name}')
do
oc debug node/${node} -- chroot /host stat -c %a
/host/var/data/kubelet/config.json
done
```

Verify that the permissions are `600`.

## Remediation
None.

## Default Value
By default, the `/var/lib/kubelet/config.json` file has permissions of `600`.

## References
1. https://docs.openshift.com/container-platform/latest/architecture/control-plane.html#understanding-machine-config-operator_control-plane
2. https://kubernetes.io/docs/tasks/administer-cluster/kubelet-config-file/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | * | * | * |
| v7 | 5.2 Maintain Secure Images | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1083, T1222 | TA0005, TA0007 | M1022 |

## Profile
**Level 1** (Automated)
