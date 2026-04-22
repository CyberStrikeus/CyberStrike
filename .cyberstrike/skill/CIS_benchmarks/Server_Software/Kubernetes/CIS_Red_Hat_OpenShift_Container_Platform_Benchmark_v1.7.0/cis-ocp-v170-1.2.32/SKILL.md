---
name: cis-ocp-v170-1.2.32
description: "Ensure that the API Server only makes use of Strong Cryptographic Ciphers (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server]
cis_id: "1.2.32"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 1.2.32

## Profile Applicability

- **Level:** 1

## Description

Ensure that the API server is configured to only use strong cryptographic ciphers.

## Rationale

TLS ciphers have had a number of known vulnerabilities and weaknesses, which can reduce the protection provided by them. By default Kubernetes supports a number of TLS ciphersuites including some that have security concerns, weakening the protection provided.

## Impact

API server clients that cannot support the custom cryptographic ciphers will not be able to make connections to the API server.

## Audit Procedure

Ciphers for the API servers, authentication operator, and ingress controller can be configured using the `tlsSecurityProfile` parameter. The ingress controller provides external access to the API server. There are four TLS security profile types:

- Old
- Intermediate
- Modern
- Custom

Only the Old, Intermediate and Custom profiles are supported at this time. Custom provides the ability to specify individual TLS security profile parameters. Follow the steps in the documentation to configure the cipher suite for Ingress and the API server.

Run the following command to obtain the TLS cipher suites used by the authentication operator:

```bash
oc get cm -n openshift-authentication v4-0-config-system-cliconfig -o jsonpath='{.data.v4\-0\-config\-system\-cliconfig}' | jq .servingInfo
```

Run the following command to obtain the TLS cipher suites used by the Kubernetes API server operator:

```bash
oc get kubeapiservers.operator.openshift.io cluster -o json |jq .spec.observedConfig.servingInfo
```

Run the following command to obtain the TLS cipher suites used by the OpenShift API server operator:

```bash
oc get openshiftapiservers.operator.openshift.io cluster -o json |jq .spec.observedConfig.servingInfo
```

Run the following command to obtain the TLS cipher suites used by the OpenShift ingress operator:

```bash
oc get -n openshift-ingress-operator ingresscontroller/default -o json | jq .status.tlsProfile
```

Make sure that `tlsSecurityProfile` is not set to `Old` and if set to `Custom`, make sure that the `minTLSVersion` is not set to `VersionTLS10` or `VersionTLS11`.
Verify the `minTLSVersion` is at least `VersionTLS12`.

Note: The HAProxy Ingress controller image does not support TLS 1.3 and because the Modern profile requires TLS 1.3, it is not supported. The Ingress Operator converts the Modern profile to Intermediate. The Ingress Operator also converts the TLS 1.0 of an Old or Custom profile to 1.1, and TLS 1.3 of a Custom profile to 1.2.

## Remediation

None.

## Default Value

By default, OpenShift uses the `Intermediate` TLS profile, which requires a minimum of TLS 1.2.

You can configure TLS security profiles by following the OpenShift TLS documentation.

## References

1. https://docs.openshift.com/container-platform/latest/security/tls-security-profiles.html
2. https://docs.openshift.com/container-platform/4.13/rest_api/config_apis/apiserver-config-openshift-io-v1.html
3. https://github.com/ssllabs/research/wiki/SSL-and-TLS-Deployment-Best-Practices#23-use-secure-cipher-suites

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | \*   | \*   |
| v7               | 1.8 Utilize Client Certificates to Authenticate Hardware Assets                 |      |      | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1552                       | TA0006  | M1041       |

## Profile

**Level 1** (Manual)
