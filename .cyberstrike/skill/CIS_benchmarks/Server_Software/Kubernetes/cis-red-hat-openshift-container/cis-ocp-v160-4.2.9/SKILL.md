---
name: cis-ocp-v160-4.2.9
description: "Ensure that the --tls-cert-file and --tls-private-key-file arguments are set as appropriate (Manual)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, worker-nodes, kubelet]
cis_id: "4.2.9"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 4.2.9

## Profile Applicability

- **Level:** 1

## Description

Setup TLS connection on the Kubelets.

## Rationale

The connections from the apiserver to the kubelet are used for fetching logs for pods, attaching (through kubectl) to running pods, and using the kubelet's port-forwarding functionality. These connections terminate at the kubelet's HTTPS endpoint. By default, the `apiserver` does not verify the kubelet's serving certificate, which makes the connection subject to man-in-the-middle attacks, and unsafe to run over untrusted and/or public networks.

## Impact

TLS and client certificate authentication must be configured for your Kubernetes cluster deployment.

## Audit Procedure

By default, OpenShift uses X.509 certificates to provide secure connections between the API server and `node/kubelet`. OpenShift Container Platform monitors certificates for proper validity, for the cluster certificates it issues and manages. The OpenShift Container Platform manages certificate rotation and the alerting framework has rules to help identify when a certificate issue is about to occur.
Use the following command to check the kubelet client certificate:

```bash
oc get configmap config -n openshift-kube-apiserver -ojson | jq -r '.data["config.yaml"]' | jq '.apiServerArguments."kubelet-client-certificate"'
```

Verify the certificate path contains `/etc/kubernetes/static-pod-certs/secrets/kubelet-client/tls.crt`.
Use the following command to check the kubelet client key:

```bash
oc get configmap config -n openshift-kube-apiserver -ojson | jq -r '.data["config.yaml"]' | jq '.apiServerArguments."kubelet-client-key"'
```

Verify the key path contains `/etc/kubernetes/static-pod-certs/secrets/kubelet-client/tls.key`.

## Remediation

OpenShift automatically manages TLS authentication for the API server communication with the `node/kubelet`. This is not configurable.

## Default Value

By default, OpenShift uses X.509 certificates to provide secure connections between the API server and `node/kubelet`. OpenShift does not use values assigned to the `tls-cert-file` or `tls-private-key-file` flags.

## References

1. https://docs.openshift.com/container-platform/latest/architecture/control-plane.html#understanding-machine-config-operator_control-plane
2. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/
3. https://rootsquash.com/2016/05/10/securing-the-kubernetes-api/
4. https://github.com/kelseyhightower/docker-kubernetes-tls-guide
5. https://jvns.ca/blog/2017/08/05/how-kubernetes-certificates-work/

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | \*   | \*   |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| N/A                         | N/A     | N/A         |

## Profile

**Level 1** (Manual)
