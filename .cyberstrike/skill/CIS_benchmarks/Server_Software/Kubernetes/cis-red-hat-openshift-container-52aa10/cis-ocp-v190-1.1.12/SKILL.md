---
name: cis-ocp-v190-1.1.12
description: "Ensure that the etcd data directory ownership is set to root:root (Manual)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags:
  [cis, openshift, kubernetes, redhat, control-plane, master-node-config-files, etcd, data-directory, file-ownership]
cis_id: "1.1.12"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 1.1.12

## Profile Applicability

- **Level:** 1

## Description

Ensure that the `etcd` data directory ownership is set to `root:root`.

## Rationale

`etcd` is a highly-available key-value store used by Kubernetes deployments for persistent storage of all of its REST API objects. This data directory should be protected from any unauthorized reads or writes. It should be owned by `root:root`.

In the OpenShift Container Platform, the ownership and permissions of the etcd data directory (usually located at /var/lib/etcd) are handled by the cluster-etcd-operator. This automation ensures the correct and secure configuration is maintained.

NOTE: The only users that exist on an RHCOS OpenShift node are root and core. This is intentional, as regular management of the underlying RHCOS cluster nodes is designed to be performed via the OpenShift API itself. The core user is a member of the wheel group, which gives it permission to use `sudo` for running privileged commands. Adding additional users at the node level is highly discouraged.

## Impact

None

## Audit Procedure

In OpenShift 4, `etcd` members are deployed on the master nodes as static pods. The `etcd` database is stored on the master nodes in `/var/lib/etcd` and mounted to the `etcd-member` container via the host path mount data-dir with the same filesystem path (`/var/lib/etcd`). The ownership for this directory on the `etcd-member` container and on the container host is `root:root`.

Starting with OCP 4.4, `etcd` is managed by the `cluster-etcd-operator`. The `etcd` operator will help to automate restoration of master nodes. There is also a new `etcdctl` container in the `etcd` static pod for quick debugging. cluster-admin rights are required to exec into `etcd` containers.

Run the following command.

```bash
for i in $(oc get pods -n openshift-etcd -l app=etcd -oname); do oc exec -n openshift-etcd -c etcd $i -- stat -c %U:%G /var/lib/etcd/member; done
```

Verify that the ownership is set to `root:root`.

## Remediation

No remediation required; file ownership is managed by the operator.

## Default Value

By default, in OpenShift 4, `etcd` data directory ownership is set to `root:root`.

## References

1. https://docs.openshift.com/container-platform/4.3/architecture/control-plane.html#defining-masters_control-plane
2. https://etcd.io/#data-dir
3. https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | \*   | \*   | \*   |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts                   | \*   | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1083, T1222                | TA0005, TA0007 | M1026       |

## Profile

**Level 1** (Manual)
