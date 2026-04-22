---
name: cis-ocp-v190-1.2.29
description: "Ensure that encryption providers are appropriately configured (Manual)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server, etcd, encryption, data-at-rest]
cis_id: "1.2.29"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 1.2.29

## Profile Applicability
- **Level:** 1

## Description
Where `etcd` encryption is used, appropriate providers should be configured.

## Rationale
Where `etcd` encryption is used, it is important to ensure that the appropriate set of encryption providers is used. Currently, the `aescbc`, `kms` and `secretbox` are likely to be appropriate options.

## Impact
When you enable `etcd` encryption, the following OpenShift API server and Kubernetes API server resources are encrypted:

- Secrets
- ConfigMaps
- Routes
- OAuth access tokens
- OAuth authorize tokens

When you enable `etcd` encryption, encryption keys are created. These keys are rotated on a weekly basis. You must have these keys in order to restore from an `etcd` backup.

## Audit Procedure
OpenShift supports encryption of data at rest of `etcd` datastore, but it is up to the customer to configure. The `aescbc` cipher had been the only supported cipher up to OCP 4.13. Starting with OCP 4.13, the `aescgm` cipher can be used as well. No other ciphers are supported. Keys are stored on the filesystem of the master and automatically rotated.

Run the following command to review the Encrypted status condition for the OpenShift API server to verify that its resources were successfully encrypted:

```bash
# encrypt the etcd datastore
oc get openshiftapiserver -o=jsonpath='{range .items[0].status.conditions[?(@.type=="Encrypted")]}{.reason}{"\n"}{.message}{"\n"}'
```

The output shows `EncryptionCompleted` upon successful encryption.

- `EncryptionCompleted`
- `All resources encrypted: routes.route.openshift.io, oauthaccesstokens.oauth.openshift.io, oauthauthorizetokens.oauth.openshift.io`

If the output shows `EncryptionInProgress`, this means that encryption is still in progress. Wait a few minutes and try again.

## Remediation
Follow the OpenShift documentation for encrypting etcd data.

## Default Value
By default, no encryption provider is set.

## References
1. https://docs.openshift.com/container-platform/latest/security/encrypting-etcd.html
2. https://docs.openshift.com/container-platform/latest/operators/index.html
3. https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/
4. https://acotten.com/post/kube17-security
5. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
6. https://github.com/kubernetes/features/issues/92
7. https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/#providers

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | * | * |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1552 | TA0006 | M1022 |

## Profile
**Level 1** (Manual)
