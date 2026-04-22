---
name: cis-ocp-v160-1.3.3
description: "Ensure that the --service-account-private-key-file argument is set as appropriate (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, controller-manager, service-account, private-key, cryptography]
cis_id: "1.3.3"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 1.3.3

## Profile Applicability
- **Level:** 1

## Description
Explicitly set a service account private key file for service accounts on the controller manager.

## Rationale
To ensure that keys for service account tokens can be rotated as needed, a separate public/private key pair should be used for signing service account tokens. The private key should be specified to the controller manager with `--service-account-private-key-file` as appropriate.

## Impact
You would need to securely maintain the key file and rotate the keys based on your organization's key rotation policy.

## Audit Procedure
OpenShift starts the Kubernetes Controller Manager with service-account-private-key-file set to `/etc/kubernetes/static-pod-resources/secrets/service-account-private-key/service-account.key`.

The bootstrap configuration and overrides are available here:
- kube-controller-manager-pod
- bootstrap-config-overrides

Run the following command:

```bash
oc get configmaps config -n openshift-kube-controller-manager -ojson | \
  jq -r '.data["config.yaml"]' | \
  jq -r '.extendedArguments["service-account-private-key-file"][]'
```

Verify that the following is returned:
`/etc/kubernetes/static-pod-resources/secrets/service-account-private-key/service-account.key`

## Remediation
None.

## Default Value
By default, OpenShift starts the controller manager with `service-account-private-key-file` set to `/etc/kubernetes/static-pod-resources/secrets/service-account-private-key/service-account.key`. OpenShift manages the service account credentials for the scheduler automatically.

## References
1. https://docs.openshift.com/container-platform/latest/operators/operator-reference.html
2. https://docs.openshift.com/container-platform/4.13/security/certificate_types_descriptions/control-plane-certificates.html
3. https://github.com/openshift/cluster-kube-controller-manager-operator/blob/release-4.5/bindata/bootkube/bootstrap-manifests/kube-controller-manager-pod.yaml
4. https://github.com/openshift/cluster-kube-controller-manager-operator/blob/release-4.5/bindata/bootkube/config/bootstrap-config-overrides.yaml
5. https://github.com/openshift/cluster-kube-controller-manager-operator/blob/release-4.5/bindata/v4.1.0/kube-controller-manager/kubeconfig-cm.yaml
6. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.2 Use Unique Passwords | X | X | X |
| v7 | 4.4 Use Unique Passwords | | X | X |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1552 | TA0006 | M1022 |

## Profile
**Level 1** (Manual)
