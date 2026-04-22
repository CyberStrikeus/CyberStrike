---
name: cis-ocp-v170-1.3.4
description: "Ensure --root-ca-file set as appropriate (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, controller-manager]
cis_id: "1.3.4"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 1.3.4

## Profile Applicability
- **Level:** 1

## Description
Allow pods to verify the API server's serving certificate before establishing connections.

## Rationale
Processes running within pods that need to contact the API server must verify the API server's serving certificate. Failing to do so could be a subject to man-in-the-middle attacks.

Providing the root certificate for the API server's serving certificate to the controller manager with the `--root-ca-file` argument allows the controller manager to inject the trusted bundle into pods so that they can verify TLS connections to the API server.

## Impact
OpenShift clusters manage and maintain certificate authorities and certificates for cluster components.

## Audit Procedure

Certificates for OpenShift platform components are automatically created and rotated by the OpenShift Container Platform.

Run the following command:

```bash
oc get configmaps config -n openshift-kube-controller-manager -ojson | \
  jq -r '.data["config.yaml"]' | \
  jq -r '.extendedArguments["root-ca-file"][]'
```

Verify that the `--root-ca-file` argument exists and is set to `/etc/kubernetes/static-pod-resources/configmaps/serviceaccount-ca/ca-bundle.crt`.

## Remediation
None.

## Default Value
By default, OpenShift sets the Kubernetes Controller Manager `root-ca-file` to `/etc/kubernetes/static-pod-resources/configmaps/serviceaccount-ca/ca-bundle.crt`.

Certificates for OpenShift platform components are automatically created and rotated by the OpenShift Container Platform.

## References
1. https://docs.openshift.com/container-platform/4.13/operators/operator-reference.html
2. https://docs.openshift.com/container-platform/latest/operators/operator-reference.html#cluster-openshift-controller-manager-operator_cluster-operators-ref
3. https://docs.openshift.com/container-platform/4.13/security/certificate_types_descriptions/control-plane-certificates.html
4. https://github.com/openshift/cluster-kube-controller-manager-operator/blob/release-4.5/bindata/bootkube/bootstrap-manifests/kube-controller-manager-pod.yaml
5. https://github.com/openshift/cluster-kube-controller-manager-operator/blob/release-4.5/bindata/bootkube/config/bootstrap-config-overrides.yaml
6. https://github.com/openshift/cluster-kube-controller-manager-operator/blob/release-4.5/bindata/v4.1.0/kube-controller-manager/kubeconfig-cm.yaml
7. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/
8. https://github.com/kubernetes/kubernetes/issues/11000

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 13.10 Perform Application Layer Filtering | | * | |
| v7 | 4.4 Use Unique Passwords | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1552 | TA0006 | M1022 |

## Profile
**Level 1** (Manual)
