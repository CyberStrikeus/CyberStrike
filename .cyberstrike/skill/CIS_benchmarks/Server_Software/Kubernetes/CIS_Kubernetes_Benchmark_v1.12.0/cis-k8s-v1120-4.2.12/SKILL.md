---
name: cis-k8s-v1120-4.2.12
description: "Ensure that the Kubelet only makes use of Strong Cryptographic Ciphers (Manual)"
category: cis-k8s
version: "1.12.0"
author: cyberstrike-official
tags: [cis, kubernetes, worker-nodes, kubelet]
cis_id: "4.2.12"
cis_benchmark: "CIS Kubernetes Benchmark v1.12.0"
tech_stack: [kubernetes]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Kubernetes Benchmark v1.12.0 - Control 4.2.12

## Description

Ensure that the Kubelet is configured to only use strong cryptographic ciphers.

## Rationale

TLS ciphers have had a number of known vulnerabilities and weaknesses, which can reduce the protection provided by them. By default Kubernetes supports a number of TLS ciphersuites including some that have security concerns, weakening the protection provided.

## Impact

Kubelet clients that cannot support modern cryptographic ciphers will not be able to make connections to the Kubelet API.

## Audit Procedure

### Step 1: Identify the approved cipher suites

The set of cryptographic ciphers currently considered secure is the following:

- `TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256`
- `TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256`
- `TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305`
- `TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384`
- `TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305`
- `TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384`

### Step 2: Verify via process arguments

Run the following command on each node:

```bash
ps -ef | grep kubelet
```

If the `--tls-cipher-suites` argument is present, ensure it only contains values included in this set.

If it is not present check that there is a Kubelet config file specified by `--config`, and that file sets `tlsCipherSuites:` to only include values from this set.

## Remediation

If using a Kubelet config file, edit the file to set `tlsCipherSuites:` to `TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305,TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305,TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384` or to a subset of these values.

If using executable arguments, edit the kubelet service file `/etc/kubernetes/kubelet.conf` on each worker node and set the `--tls-cipher-suites` parameter as follows, or to a subset of these values.

```
--tls-cipher-suites=TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305,TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305,TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,TLS_RSA_WITH_AES_128_GCM_SHA256
```

Based on your system, restart the `kubelet` service. For example:

```bash
systemctl daemon-reload
systemctl restart kubelet.service
```

## Default Value

By default the Kubernetes API server supports a wide range of TLS ciphers.

## Additional Information

The list chosen above should be fine for modern clients. It's essentially the list from the Mozilla "Modern cipher" option with the ciphersuites supporting CBC mode removed, as CBC has traditionally had a lot of issues.

## References

None specified.

## CIS Controls

| Controls Version | Control                                                                                                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software<br>Uninstall or disable unnecessary services on enterprise assets and software. |      | ●    | ●    |
| v7               | 5.1 Establish Secure Configurations<br>Maintain documented, standard security configuration standards for all authorized operating systems and software.        | ●    | ●    | ●    |

## Profile Applicability

- Level 1 - Worker Node

## Assessment Status

Manual
