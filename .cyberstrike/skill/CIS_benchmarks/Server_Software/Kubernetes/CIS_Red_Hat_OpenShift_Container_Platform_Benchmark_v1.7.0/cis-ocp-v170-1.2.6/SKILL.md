---
name: cis-ocp-v170-1.2.6
description: "Verify that the kubelet certificate authority is set as appropriate (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server]
cis_id: "1.2.6"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 1.2.6

## Profile Applicability
- **Level:** 1

## Description
Verify kubelet's certificate before establishing connection.

## Rationale
The connections from the apiserver to the kubelet are used for fetching logs for pods, attaching (through kubectl) to running pods, and using the kubelet's port-forwarding functionality. These connections terminate at the kubelet's HTTPS endpoint. By default, the apiserver does not verify the kubelet's serving certificate, which makes the connection subject to man-in-the-middle attacks, and unsafe to run over untrusted and/or public networks.

## Impact
You require TLS to be configured on apiserver as well as kubelets.

## Audit Procedure
OpenShift does not use the `--kubelet-certificate-authority` flag. OpenShift utilizes X.509 certificates for authentication of the control-plane components. OpenShift configures the API server to use an internal certificate authority (CA) to validate the user certificate sent during TLS negotiation. If the CA validation of the certificate is successful, the request is authenticated and user information is derived from the certificate subject fields.

To verify, run the following command:

```bash
# For 4.6 and above

oc get configmap config -n openshift-kube-apiserver -ojson | jq -r '.data["config.yaml"]' | jq '.apiServerArguments["kubelet-certificate-authority"]'
```

Verify the ca-bundle.crt is located as following:
`/etc/kubernetes/static-pod-resources/configmaps/kubelet-serving-ca/ca-bundle.crt`

## Remediation
No remediation is required. OpenShift platform components use X.509 certificates for authentication. OpenShift manages the CAs and certificates for platform components. This is not configurable.

## Default Value
By default, kubelet authentication is managed with X.509 certificates.

## References
1. https://docs.openshift.com/container-platform/4.13/operators/operator-reference.html
2. https://docs.openshift.com/container-platform/4.13/operators/operator-reference.html
3. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
4. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet-authentication-authorization/
5. https://kubernetes.io/docs/concepts/architecture/control-plane-node-communication/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 16.11 Leverage Vetted Modules or Services for Application Security Components | | * | * |
| v7 | 1.8 Utilize Client Certificates to Authenticate Hardware Assets | | | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1048, T1189 | TA0001, TA0010 | M1041 |

## Profile
**Level 1** (Manual)
