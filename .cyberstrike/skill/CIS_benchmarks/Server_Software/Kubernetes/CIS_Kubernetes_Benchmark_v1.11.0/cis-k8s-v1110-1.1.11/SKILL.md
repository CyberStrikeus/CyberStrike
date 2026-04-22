---
name: cis-k8s-v1110-1.1.11
description: "Ensure that the etcd data directory permissions are set to 700 or more restrictive (Automated)"
category: cis-k8s
version: "1.11.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, config-files, file-permissions, etcd, data-directory]
cis_id: "1.1.11"
cis_benchmark: "CIS Kubernetes Benchmark v1.11.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1.11 Ensure that the etcd data directory permissions are set to 700 or more restrictive (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

Ensure that the etcd data directory has permissions of `700` or more restrictive.

## Rationale

etcd is a highly-available key-value store used by Kubernetes deployments for persistent storage of all of its REST API objects. This data directory should be protected from any unauthorized reads or writes. It should not be readable or writable by any group members or the world.

## Impact

None

## Audit

On the etcd server node, get the etcd data directory, passed as an argument `--data-dir`, from the below command:

```bash
ps -ef | grep etcd
```

Run the below command (based on the etcd data directory found above). For example,

```bash
stat -c %a /var/lib/etcd
```

Verify that the permissions are `700` or more restrictive.

## Remediation

On the etcd server node, get the etcd data directory, passed as an argument `--data-dir`, from the below command:

```bash
ps -ef | grep etcd
```

Run the below command (based on the etcd data directory found above). For example,

```bash
chmod 700 /var/lib/etcd
```

## Default Value

By default, etcd data directory has permissions of `755`.

## References

1. [https://coreos.com/etcd/docs/latest/op-guide/configuration.html#data-dir](https://coreos.com/etcd/docs/latest/op-guide/configuration.html#data-dir)
2. [https://kubernetes.io/docs/admin/etcd/](https://kubernetes.io/docs/admin/etcd/)

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                    | IG 1 | IG 2 | IG 3 |
| :--------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--: | :--: | :--: |
|        v8        | **3.3 Configure Data Access Control Lists** - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        |  \*  |  \*  |  \*  |
|        v7        | **14.6 Protect Information through Access Control Lists** - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. |  \*  |  \*  |  \*  |
