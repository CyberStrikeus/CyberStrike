---
name: cis-k8s-v200-2.4
description: "Ensure that the --peer-cert-file and --peer-key-file arguments are set as appropriate (Automated)"
category: cis-k8s
version: "2.0.0"
author: cyberstrike-official
tags: [cis, kubernetes, etcd]
cis_id: "2.4"
cis_benchmark: "CIS Kubernetes Benchmark v2.0.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Kubernetes Benchmark v2.0.0 - Control 2.4

## Profile Applicability
- **Level:** 1 - Master Node

## Description
etcd should be configured to make use of TLS encryption for peer connections.

## Rationale
etcd is a highly-available key value store used by Kubernetes deployments for persistent storage of all of its REST API objects. These objects are sensitive in nature and should be encrypted in transit and also amongst peers in the etcd clusters.

## Impact
etcd cluster peers would need to set up TLS for their communication.

## Audit Procedure

Run the following command on the etcd server node:

```bash
ps -ef | grep etcd
```

Verify that the `--peer-cert-file` and `--peer-key-file` arguments are set as appropriate.

**Note:** This recommendation is applicable only for etcd clusters. If you are using only one etcd server in your environment then this recommendation is not applicable.

## Remediation

Follow the etcd service documentation and configure peer TLS encryption as appropriate for your etcd cluster.

Then, edit the etcd pod specification file `/etc/kubernetes/manifests/etcd.yaml` on the master node and set the below parameters.

```
--peer-client-file=</path/to/peer-cert-file>
--peer-key-file=</path/to/peer-key-file>
```

## Default Value
**Note:** This recommendation is applicable only for etcd clusters. If you are using only one etcd server in your environment then this recommendation is not applicable.

By default, peer communication over TLS is not configured.

## References
1. https://coreos.com/etcd/docs/latest/op-guide/security.html
2. https://kubernetes.io/docs/admin/etcd/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.11 Encrypt Sensitive Data at Rest<br/>Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data. Storage-layer encryption, also known as server-side encryption, meets the minimum requirement of this Safeguard. Additional encryption methods may include application-layer encryption, also known as client-side encryption, where access to the data storage device(s) does not permit access to the plain-text data. | | ● | ● |
| v7 | 14.4 Encrypt All Sensitive Information in Transit<br/>Encrypt all sensitive information in transit. | | ● | ● |

## Profile
**Level 1 - Master Node** (Automated)
