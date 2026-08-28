---
name: cis-ocp-vm-v100-1-5
description: "Enforce the use of trusted registries using TLS (Automated)"
category: cis-openshift-virtualization
version: "1.0"
author: cyberstrike-official
tags:
  [
    cis,
    openshift,
    kubernetes,
    openshift-virtualization,
    kubevirt,
    vm,
    platform-configuration,
    tls,
    registry,
    supply-chain,
  ]
cis_id: "1.5"
cis_benchmark: "CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0"
tech_stack: [kubernetes, openshift, openshift-virtualization, kubevirt]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.5 — Enforce the use of trusted registries using TLS

## Profile Applicability

- Level 1

## Description

Transport Layer Security (TLS) is a cryptographic protocol used in this context to protect data in transit. Restricting operations to the use of trusted registries ensures the use of approved container images.

## Rationale

By only pulling container images from trusted registries, organizations can reduce the risk of introducing unknown vulnerabilities or malicious software into their systems. This helps ensure that their applications and systems remain secure and stable.

## Impact

Enforcing trusted container image registries limits which container images users are able to deploy and manage. This restriction may also limit the use of some platforms and/or tools.

## Audit Procedure

Use the following command to view any insecure registries:

```bash
$ oc get hyperconverged kubevirt-hyperconverged -n openshift-cnv -ojsonpath='{.spec.storageImport.insecureRegistries}'
```

Verify no registries are returned.

## Remediation

Do not allow connections to insecure registries from hyperconverged resources. The cluster administrator can remove any insecure registry:

```bash
$ oc patch hyperconverged kubevirt-hyperconverged -n openshift-cnv --type='json' -p='[
{"op": "remove", "path": "/spec/storageImport/insecureRegistries"},
]'
```

## Default Value

TLS is enabled by default. No insecure registries are configured or enabled by default. The result of the command should be empty.

## References

- CIS Redhat OpenShift Virtual Machine Extension Benchmark v1.0.0, Section 1.5

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            | N    | Y    | Y    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic            | Technique                     |
| ----------------- | ----------------------------- |
| Initial Access    | T1195 Supply Chain Compromise |
| Credential Access | T1040 Network Sniffing        |

## Profile

- Level 1 - OpenShift Virtualization
