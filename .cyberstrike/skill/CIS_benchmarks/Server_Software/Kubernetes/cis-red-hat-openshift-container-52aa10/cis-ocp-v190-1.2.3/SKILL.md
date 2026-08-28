---
name: cis-ocp-v190-1.2.3
description: "Ensure that the kubelet uses certificates to authenticate (Manual)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server, kubelet, certificates, authentication]
cis_id: "1.2.3"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 1.2.3

## Profile Applicability

- **Level:** 1

## Description

Enable certificate based kubelet authentication.

## Rationale

The apiserver, by default, does not authenticate itself to the kubelet's HTTPS endpoints. The requests from the apiserver are treated anonymously. You should set up certificate-based kubelet authentication to ensure that the apiserver authenticates itself to kubelets when submitting requests.

## Impact

Require TLS to be configured on the apiserver as well as kubelets.

## Audit Procedure

OpenShift does not use the `--kubelet-client-certificate` or the `kubelet-client-key` arguments. OpenShift utilizes X.509 certificates for authentication of the control-plane components. OpenShift configures the API server to use an internal certificate authority (CA) to validate the user certificate sent during TLS negotiation. If the CA validation of the certificate is successful, the request is authenticated and user information is derived from the certificate subject fields.

To verify the certificates are present, run the following command:

```bash
#for OpenShift 4.6 and above
oc get configmap config -n openshift-kube-apiserver -ojson | jq -r '.data["config.yaml"]' | jq '.apiServerArguments["kubelet-client-certificate"]'

oc get configmap config -n openshift-kube-apiserver -ojson | jq -r '.data["config.yaml"]' | jq '.apiServerArguments["kubelet-client-key"]'

oc -n openshift-kube-apiserver describe secret serving-cert
```

Verify that the kubelet client-certificate and kubelet client-key files are present.

client-certificate:
`/etc/kubernetes/static-pod-certs/secrets/kubelet-client/tls.crt`

client-key:
`/etc/kubernetes/static-pod-certs/secrets/kubelet-client/tls.key`

Verify that the serving-cert for the `openshift-apiserver` is type `kubernetes.io/tls` and that returned Data includes `tls.crt` and `tls.key`.

## Remediation

No remediation is required. OpenShift platform components use X.509 certificates for authentication. OpenShift manages the CAs and certificates for platform components. This is not configurable.

## Default Value

By default, kubelet authentication is managed with X.509 certificates.

## References

1. https://github.com/openshift/cluster-kube-apiserver-operator/blob/release-4.13/bindata/assets/config/defaultconfig.yaml#L124-L127
2. https://kubernetes.io/docs/admin/kube-apiserver/
3. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet-authentication-authorization/
4. https://kubernetes.io/docs/concepts/architecture/control-plane-node-communication/
5. https://docs.openshift.com/container-platform/4.13/operators/operator-reference.html#kube-apiserver-operator_red-hat-operators
6. https://docs.openshift.com/container-platform/4.13/operators/operator-reference.html#openshift-apiserver-operator_red-hat-operators

## CIS Controls

| Controls Version | Control                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.11 Leverage Vetted Modules or Services for Application Security Components |      | \*   | \*   |
| v7               | 1.8 Utilize Client Certificates to Authenticate Hardware Assets               |      |      | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1048, T1189                | TA0001, TA0010 | M1041       |

## Profile

**Level 1** (Manual)
