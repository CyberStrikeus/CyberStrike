---
name: cis-k8s-v1120-4.2.3
description: "Ensure that the --client-ca-file argument is set as appropriate (Automated)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, worker-nodes, kubelet]
cis_id: "4.2.3"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Kubernetes Benchmark v1.12.0 - Control 4.2.3

## Description

Enable Kubelet authentication using certificates.

## Rationale

The connections from the apiserver to the kubelet are used for fetching logs for pods, attaching (through kubectl) to running pods, and using the kubelet's port-forwarding functionality. These connections terminate at the kubelet's HTTPS endpoint. By default, the apiserver does not verify the kubelet's serving certificate, which makes the connection subject to man-in-the-middle attacks, and unsafe to run over untrusted and/or public networks. Enabling Kubelet certificate authentication ensures that the apiserver could authenticate the Kubelet before submitting any requests.

## Impact

You require TLS to be configured on apiserver as well as kubelets.

## Audit Procedure

### Step 1: Verify via process arguments

Run the following command on each node:

```bash
ps -ef | grep kubelet
```

Verify that the `--client-ca-file` argument exists and is set to the location of the client certificate authority file.

If the `--client-ca-file` argument is not present, check that there is a Kubelet config file specified by `--config`, and that the file sets `authentication: x509: clientCAFile` to the location of the client certificate authority file.

## Remediation

If using a Kubelet config file, edit the file to set `authentication: x509: clientCAFile` to the location of the client CA file.

If using command line arguments, edit the kubelet service file `/etc/kubernetes/kubelet.conf` on each worker node and set the below parameter in `KUBELET_AUTHZ_ARGS` variable.

```
--client-ca-file=<path/to/client-ca-file>
```

Based on your system, restart the `kubelet` service. For example:

```bash
systemctl daemon-reload
systemctl restart kubelet.service
```

## Default Value

By default, `--client-ca-file` argument is not set.

## References

1. https://kubernetes.io/docs/admin/kubelet/
2. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet-authentication-authorization/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.10 Encrypt Sensitive Data in Transit<br>Encrypt sensitive data in transit. Example implementations can include: Transport Layer Security (TLS) and Open Secure Shell (OpenSSH). | | ● | ● |
| v7 | 14.4 Encrypt All Sensitive Information in Transit<br>Encrypt all sensitive information in transit. | | ● | ● |

## Profile Applicability

- Level 1 - Worker Node

## Assessment Status

Automated
