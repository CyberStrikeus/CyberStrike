---
name: cis-ocp-v190-4.2.12
description: "Ensure that the Kubelet only makes use of Strong Cryptographic Ciphers (Manual)"
category: cis-openshift
version: "1.9.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, worker-nodes, kubelet]
cis_id: "4.2.12"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.9.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.9.0 - Control 4.2.12

## Profile Applicability
- **Level:** 1

## Description
Ensure that the Kubelet is configured to only use strong cryptographic ciphers.

## Rationale
TLS ciphers have had a number of known vulnerabilities and weaknesses, which can reduce the protection provided by them. By default Kubernetes supports a number of TLS ciphersuites including some that have security concerns, weakening the protection provided.

## Impact
Kubelet clients that cannot support modern cryptographic ciphers will not be able to make connections to the Kubelet API.

## Audit Procedure
The set of cryptographic ciphers currently considered secure is the following:

```
TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256
TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305
TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384
TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305
TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384
TLS_RSA_WITH_AES_256_GCM_SHA384
TLS_RSA_WITH_AES_128_GCM_SHA256
```

Ciphers for the API servers, authentication and the ingress controller can be configured using the `tlsSecurityProfile` parameter as of OpenShift 4.3. The ingress controller provides external access to the API server. There are four TLS security profile types:

- Old
- Intermediate
- Modern
- Custom

Only the Old, Intermediate and Custom profiles are supported at this time for the Ingress controller. Custom provides the ability to specify individual TLS security profile parameters. Follow the steps in the documentation to configure the cipher suite for Ingress, API server and Authentication.

Run the following commands to verify the cipher suite and minTLSversion for the ingress operator, authentication operator, `cliconfig`, OpenShift `APIserver` and Kube APIserver.

Use the following command to verify the available ciphers:

```bash
oc get --namespace=openshift-ingress-operator ingresscontroller/default -ojson | jq .status.tlsProfile.ciphers
```

Verify the ciphers used by the Kubernetes API server:

```bash
oc get kubeapiservers.operator.openshift.io cluster -ojson | jq .spec.observedConfig.servingInfo.cipherSuites
```

Verify the ciphers used by the OpenShift API server:

```bash
oc get openshiftapiservers.operator.openshift.io cluster -ojson | jq .spec.observedConfig.servingInfo.cipherSuites
```

Verify the ciphers used by OpenShift authentication:

```bash
oc get cm -n openshift-authentication v4-0-config-system-cliconfig -o jsonpath='{.data.v4\-0\-config\-system\-cliconfig}' | jq .servingInfo.cipherSuites
```

Verify `tlsSecurityProfile` is using the default value:

```bash
oc get kubeapiservers.operator.openshift.io cluster -ojson | jq .spec.tlsSecurityProfile
```

Verify that the cipher suites are appropriate.

Verify that the `tlsSecurityProfile` is set to the value you chose, or using the default of `Intermediate`.

Note: The HAProxy Ingress controller image does not support TLS 1.3 and because the `Modern` profile requires TLS 1.3, it is not supported. The Ingress Operator converts the `Modern` profile to `Intermediate`. The Ingress Operator also converts the TLS 1.0 of an `Old` or `Custom` profile to 1.1, and TLS 1.3 of a `Custom` profile to 1.2.

## Remediation
Follow the directions above and in the OpenShift documentation to configure the `tlsSecurityProfile`. Configuring Ingress.

Please reference the OpenShift TLS security profile documentation for more detail on each profile.

## Default Value
By default the Kubernetes API server supports a wide range of TLS ciphers.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.2 Use Unique Passwords | * | * | * |
| v7 | 1.8 Utilize Client Certificates to Authenticate Hardware Assets | | | * |
| v7 | 2.6 Address unapproved software | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|

## Profile
**Level 1** (Manual)
