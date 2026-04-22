---
name: cis-k8s-v200-1.1.12
description: "Ensure that the etcd data directory ownership is set to etcd:etcd (Automated)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, control-plane, config-files, file-ownership, etcd, data-directory]
cis_id: "1.1.12"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1.12 Ensure that the etcd data directory ownership is set to etcd:etcd (Automated)

## Profile Applicability

- Level 1 - Master Node

## Description

Ensure that the etcd data directory ownership is set to `etcd:etcd`.

## Rationale

etcd is a highly-available key-value store used by Kubernetes deployments for persistent storage of all of its REST API objects. This data directory should be protected from any unauthorized reads or writes. It should be owned by `etcd:etcd`.

## Impact

None

## Audit

On the etcd server node, get the etcd data directory, passed as an argument `--data-dir`, from the below command:

```bash
ps -ef | grep etcd
```

Run the below command (based on the etcd data directory found above). For example,

```bash
stat -c %U:%G /var/lib/etcd
```

Verify that the ownership is set to `etcd:etcd`.

## Remediation

On the etcd server node, get the etcd data directory, passed as an argument `--data-dir`, from the below command:

```bash
ps -ef | grep etcd
```

Run the below command (based on the etcd data directory found above). For example,

```bash
chown etcd:etcd /var/lib/etcd
```

## Default Value

By default, etcd data directory ownership is set to `etcd:etcd`.

## References

1. https://coreos.com/etcd/docs/latest/op-guide/configuration.html#data-dir
2. https://kubernetes.io/docs/admin/etcd/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | \*   | \*   | \*   |
| v7               | 16 Account Monitoring and Control - Account Monitoring and Control                                                                                                                                                                              |      |      |      |
