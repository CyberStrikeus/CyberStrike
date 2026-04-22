---
name: cis-ocp-v160-4.1.8
description: "Ensure that the client certificate authorities file ownership is set to root:root (Automated)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, worker-nodes, worker-node-config-files]
cis_id: "4.1.8"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 4.1.8

## Profile Applicability
- **Level:** 1

## Description
Ensure that the certificate authorities file ownership is set to `root:root`.

## Rationale
The certificate authorities file controls the authorities used to validate API requests. You should set its file ownership to maintain the integrity of the file. The file should be owned by `root:root`.

## Impact
None.

## Audit Procedure
The Client CA location for the `kubelet` is defined in `/etc/kubernetes/kubelet.conf` and is `/etc/kubernetes/kubelet-ca.crt` by default.
Run the following command to view the user and group ownership:

```bash
for node in $(oc get nodes -o jsonpath='{.items[*].metadata.name}')
do
      oc debug node/${node} -- chroot /host stat -c %U:%G /etc/kubernetes/kubelet-ca.crt
done
```

Verify that the ownership is set to `root:root`.

## Remediation
None.

## Default Value
By default, in OpenShift 4, the `--client-ca-file` is set to `/etc/kubernetes/kubelet-ca.crt` with ownership `root:root`.

## References
1. https://docs.openshift.com/container-platform/latest/architecture/control-plane.html#understanding-machine-config-operator_control-plane
2. https://kubernetes.io/docs/reference/access-authn-authz/authentication/#x509-client-certs

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | * | * | * |
| v7 | 4.3 Ensure the Use of Dedicated Administrative Accounts | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1083, T1222 | TA0005, TA0007 | M1026 |

## Profile
**Level 1** (Automated)
