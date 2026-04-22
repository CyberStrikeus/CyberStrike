---
name: cis-ocp-v180-1.2.27
description: "Ensure that the --tls-ca-file argument is set (Manual)"
category: cis-openshift
version: "1.8.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, control-plane, api-server]
cis_id: "1.2.27"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.8.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.8.0 - Control 1.2.27

## Profile Applicability
- **Level:** 1

## Description
Setup TLS connection on the API server.

## Rationale
API server communication contains sensitive parameters that should remain encrypted in transit. Configure the API server to serve only HTTPS traffic. If `--client-ca-file` argument is set, any request presenting a client certificate signed by one of the authorities in the `client-ca-file` is authenticated with an identity corresponding to the CommonName of the client certificate.

## Impact
TLS and client certificate authentication must be configured for your Kubernetes cluster deployment. By default, OpenShift uses X.509 certificates to provide secure connections between the API server and node/kubelet. OpenShift Container Platform monitors certificates for proper validity, for the cluster certificates it issues and manages. The OpenShift Container Platform alerting framework has rules to help identify when a certificate issue is about to occur. These rules consist of the following checks:

- API server client certificate expiration is less than five minutes.

## Audit Procedure
OpenShift uses X.509 certificates to provide secure connections between API server and node/kubelet by default. OpenShift configures the `client-ca-file` value and does not use value assigned to the `client-ca-file` flag. OpenShift generates the necessary files and sets the arguments appropriately.

The API server is accessible by clients external to the cluster at `api.<cluster_name>.<base_domain>`. The administrator must set a custom default certificate to be used by the API server when serving content in order to enable clients to access the API server at a different host name or without the need to distribute the cluster-managed certificate authority (CA) certificates to the clients.

Run the following command:

```bash
oc get configmap config -n openshift-kube-apiserver -ojson | \
  jq -r '.data["config.yaml"]' | \
  jq -r .servingInfo.clientCA
```

Verify the following file exists: `/etc/kubernetes/static-pod-certs/configmaps/client-ca/ca-bundle.crt`

## Remediation
None.

## Default Value
By default, OpenShift configures the `client-ca-file` and automatically manages the certificate. It does not use the value assigned to the `client-ca-file` flag.

You may optionally set a custom default certificate to be used by the API server when serving content in order to enable clients to access the API server at a different host name or without the need to distribute the cluster-managed certificate authority (CA) certificates to the clients.

Please follow the OpenShift documentation for providing certificates for OpenShift to use.

## References
1. https://docs.openshift.com/container-platform/latest/security/certificate_types_descriptions/user-provided-certificates-for-api-server.html
2. https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/
3. https://rootsquash.com/2016/05/10/securing-the-kubernetes-api/
4. https://github.com/kelseyhightower/docker-kubernetes-tls-guide

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.10 Encrypt Sensitive Data in Transit | | * | * |
| v7 | 14.4 Encrypt All Sensitive Information in Transit | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1552 | TA0006 | M1022 |

## Profile
**Level 1** (Manual)
