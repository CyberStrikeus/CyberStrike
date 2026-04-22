---
name: cis-ocp-v170-1.1.14
description: "Ensure that the kubeconfig file ownership is set to root:root (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, master-node, config-files]
cis_id: "1.1.14"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 1.1.14

## Profile Applicability
- **Level:** 1

## Description
Ensure that the `kubeconfig` file ownership is set to `root:root`.

## Rationale
The `kubeconfig` file contains the admin credentials for the cluster. You should set its file ownership to maintain the integrity of the file. The file should be owned by `root:root`.

## Impact
None.

## Audit Procedure
In OpenShift 4 the admin config file is stored in `/etc/kubernetes/kubeconfig` with ownership `root:root`.

Run the following command.

```bash
for i in $(oc get nodes  -o name)
 do
  echo $i
  oc debug $i --  <<EOF
       chroot /host
       stat -c %U:%G  /etc/kubernetes/kubeconfig
EOF
 done
```

Verify that the ownership is set to `root:root`.

## Remediation
No remediation required; file permissions are managed by the operator.

## Default Value
By default, in OpenShift 4, `kubeconfig` file ownership is set to `root:root`.

## References
1. https://docs.openshift.com/container-platform/latest/cli_reference/openshift_cli/administrator-cli-commands.html
2. https://kubernetes.io/docs/reference/setup-tools/kubeadm/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | * | * | * |
| v7 | 4.3 Ensure the Use of Dedicated Administrative Accounts | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1083, T1222 | TA0005, TA0007 | M1026 |

## Profile
**Level 1** (Manual)
