---
name: cis-ocp-v180-4.1.7
description: "Ensure that the certificate authorities file permissions are set to 644 or more restrictive (Automated)"
category: cis-openshift
version: "1.8.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, worker-node, config-files]
cis_id: "4.1.7"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.8.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.8.0 - Control 4.1.7

## Profile Applicability

- **Level:** 1

## Description

Ensure that the certificate authorities file has permissions of `644` or more restrictive.

## Rationale

The certificate authorities file controls the authorities used to validate API requests. You should restrict its file permissions to maintain the integrity of the file. The file should be writable by only the administrators on the system.

## Impact

None

## Audit Procedure

Use the following command to check the `clientCAFile` for each node in the cluster:

```bash
for node in $(oc get nodes -ojsonpath='{.items[*].metadata.name}')
do
oc get --raw /api/v1/nodes/$node/proxy/configz | jq
'.kubeletconfig.authentication.x509.clientCAFile'
done
```

Which should result in output like the following:
/etc/kubernetes/kubelet-ca.crt

Next, check the file permissions on each node:

```bash
for node in $(oc get nodes -o jsonpath='{.items[*].metadata.name}')
do
oc debug node/${node} -- chroot /host stat -c %a /etc/kubernetes/kubelet-ca.crt
done
```

OR

```bash
for node in $(oc get nodes -o jsonpath='{.items[*].metadata.name}')
do
oc debug node/${node} -- chroot /host stat -c %a
/host/etc/kubernetes/kubelet-ca.crt
done
```

Verify that the permissions are `644`.

## Remediation

None.

## Default Value

By default, in OpenShift 4, the `kubelet-ca.crt` file has permissions set to `644`.

## References

1. https://docs.openshift.com/container-platform/latest/architecture/control-plane.html#about-machine-config-operator_control-plane
2. https://kubernetes.io/docs/reference/access-authn-authz/authentication/#x509-client-certs

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

**Level 1** (Automated)
