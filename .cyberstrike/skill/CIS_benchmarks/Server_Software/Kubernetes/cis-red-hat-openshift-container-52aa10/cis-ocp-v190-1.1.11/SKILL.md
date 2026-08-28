---
name: cis-ocp-v190-1.1.11
description: "Ensure that the etcd data directory permissions are set to 700 or more restrictive (Manual)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags:
  [cis, openshift, kubernetes, redhat, control-plane, master-node-config-files, etcd, data-directory, file-permissions]
cis_id: "1.1.11"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 1.1.11

## Profile Applicability

- **Level:** 1

## Description

Ensure that the etcd data directory has permissions of `700` or more restrictive.

## Rationale

`etcd` is a highly-available key-value store used by Kubernetes deployments for persistent storage of all of its REST API objects. This data directory should be protected from any unauthorized reads or writes. It should not be readable or writable by any group members or the world.

## Impact

None

## Audit Procedure

In OpenShift 4, `etcd` members are deployed on the master nodes as static pods. The pod specification file is created on control plane nodes at `/etc/kubernetes/manifests/etcd-member.yaml`. The `etcd` database is stored on the container host in `/var/lib/etcd` and mounted to the `etcd-member` container via the host path mount data-dir with the same filesystem path (`/var/lib/etcd`). The permissions for this directory on the container host is `700`.

Starting with OCP 4.4, `etcd` is managed by the `cluster-etcd-operator`. The `etcd` operator will help to automate restoration of master nodes. There is also a new `etcdctl` container in the `etcd` static pod for quick debugging. cluster-admin rights are required to exec into `etcd` containers.

Run the following commands.

```bash
for i in $(oc get pods -n openshift-etcd -l app=etcd -oname); do oc exec -n openshift-etcd -c etcd $i -- stat -c %a%n /var/lib/etcd/member; done
```

Verify that the permissions are `700`.

## Remediation

No remediation required. File permissions are managed by the `etcd` operator.

## Default Value

By default, `etcd` data directory has permissions of `700`.

## References

1. https://docs.openshift.com/container-platform/4.3/architecture/control-plane.html#defining-masters_control-plane
2. https://etcd.io/#data-dir
3. https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/

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

**Level 1** (Manual)
