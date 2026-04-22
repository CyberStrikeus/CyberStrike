---
name: cis-ocp-v170-1.2.27
description: "Ensure that the --etcd-certfile and --etcd-keyfile arguments are set as appropriate (Manual)"
category: cis-openshift
version: "1.7.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server]
cis_id: "1.2.27"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.7.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.7.0 - Control 1.2.27

## Profile Applicability

- **Level:** 1

## Description

`etcd` should be configured to make use of TLS encryption for client connections.

## Rationale

`etcd` is a highly-available key value store used by Kubernetes deployments for persistent storage of all of its REST API objects. These objects are sensitive in nature and should be protected by client authentication. This requires the API server to identify itself to the `etcd` server using a client certificate and key.

## Impact

TLS and client certificate authentication are configured by default for `etcd`.

## Audit Procedure

OpenShift uses X.509 certificates to provide secure communication to `etcd`. OpenShift configures these automatically. OpenShift does not use the `etcd-certfile` or `etcd-keyfile` flags. Certificates are used for encrypted communication between `etcd` member peers, as well as encrypted client traffic. The following certificates are generated and used by `etcd` and other processes that communicate with `etcd`:

- Peer certificates: Used for communication between `etcd` members.
- Client certificates: Used for encrypted server-client communication. Client certificates are currently used by the API server only, and no other service should connect to `etcd` directly except for the proxy. Client secrets (`etcd-client`, `etcd-metric-client`, `etcd-metric-signer`, and `etcd-signer`) are added to the `openshift-config`, `openshift-monitoring`, and `openshift-kube-apiserver` namespaces.
- Server certificates: Used by the `etcd` server for authenticating client requests.
- Metric certificates: All metric consumers connect to proxy with `metric-client` certificates.

Run the following command to check the location of the `etcd-certfile`:

```bash
oc get configmap config -n openshift-kube-apiserver -ojson | \
  jq -r '.data["config.yaml"]' | \
  jq -r '.apiServerArguments["etcd-certfile"]'
```

Verify that `/etc/kubernetes/static-pod-resources/secrets/etcd-client/tls.crt` is returned.

Run the following command to check the location of the `etcd-keyfile`:

```bash
oc get configmap config -n openshift-kube-apiserver -ojson | \
  jq -r '.data["config.yaml"]' | \
  jq -r '.apiServerArguments["etcd-keyfile"]'
```

Verify that `/etc/kubernetes/static-pod-resources/secrets/etcd-client/tls.key` is returned.

## Remediation

OpenShift automatically manages TLS and client certificate authentication for `etcd`. This is not configurable.

## Default Value

By default, OpenShift uses X.509 certificates to provide secure communication to `etcd`. OpenShift configures these automatically. OpenShift does not use the `etcd-certfile` or `etcd-keyfile` flags. OpenShift generates the necessary files and sets the arguments appropriately.

## References

1. https://docs.openshift.com/container-platform/latest/security/certificate_types_descriptions/etcd-certificates.html
2. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
3. https://etcd.io/

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest        |      | \*   | \*   |
| v7               | 14.8 Encrypt Sensitive Information at Rest |      |      | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1552                       | TA0006  | M1022       |

## Profile

**Level 1** (Manual)
