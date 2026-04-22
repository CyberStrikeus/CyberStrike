---
name: cis-ocp-v190-1.1.13
description: "Ensure that the kubeconfig file permissions are set to 600 or more restrictive (Manual)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, master-node-config-files, kubeconfig, admin, file-permissions]
cis_id: "1.1.13"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 1.1.13

## Profile Applicability
- **Level:** 1

## Description
Ensure that the `kubeconfig` file has permissions of `600` or more restrictive.

## Rationale
The administrator `kubeconfig` file defines various settings for the administration of the cluster. You should restrict its file permissions to maintain the integrity of the file. The file should be writable by only the administrators on the system.

## Impact
None.

## Audit Procedure
In OpenShift 4 the admin config file is stored in `/etc/kubernetes/kubeconfig` with permissions `600`.

Run the following command:

```bash
for i in $(oc get nodes  -o name)
do
  oc debug $i --  <<EOF
       chroot /host
       stat -c%a /etc/kubernetes/kubeconfig
EOF
done
```

Verify that the permissions are `600` or more restrictive.

## Remediation
There is no remediation for updating the permissions of `kubeconfig`. The file is owned by an OpenShift operator and any changes to the file will result in a degraded cluster state.

Please do not attempt to remediate the permissions of this file.

## Default Value
By default, in OpenShift 4.14, the `kubeconfig` has permissions of `600`.

In older versions of OpenShift, the `kubeconfig` has permissions of `644`, and is not remediable. Please upgrade to OpenShift 4.14 when possible.

## References
1. https://docs.openshift.com/container-platform/4.5/cli_reference/openshift_cli/administrator-cli-commands.html
2. https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | * | * | * |
| v7 | 14.6 Protect Information through Access Control Lists | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1083, T1222 | TA0005, TA0007 | M1022 |

## Profile
**Level 1** (Manual)
