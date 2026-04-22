---
name: cis-ocp-v160-4.2.4
description: "Ensure that the --client-ca-file argument is set as appropriate (Automated)"
category: cis-openshift
version: "1.6.0"
author: cyberstrike-official
tags: [cis, openshift, kubernetes, redhat, worker-nodes, kubelet]
cis_id: "4.2.4"
cis_benchmark: "CIS Red Hat OpenShift Container Platform Benchmark v1.6.0"
tech_stack: [kubernetes, openshift, redhat]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Red Hat OpenShift Container Platform Benchmark v1.6.0 - Control 4.2.4

## Profile Applicability
- **Level:** 1

## Description
Enable Kubelet authentication using certificates.

## Rationale
The connections from the apiserver to the kubelet are used for fetching logs for pods, attaching (through kubectl) to running pods, and using the kubelet's port-forwarding functionality. These connections terminate at the kubelet's HTTPS endpoint. By default, the apiserver does not verify the kubelet's serving certificate, which makes the connection subject to man-in-the-middle attacks, and unsafe to run over untrusted and/or public networks. Enabling Kubelet certificate authentication ensures that the apiserver could authenticate the Kubelet before submitting any requests.

## Impact
You require TLS to be configured on apiserver as well as kubelets.

## Audit Procedure
OpenShift provides integrated management of certificates for internal cluster components. OpenShift 4 includes multiple CAs providing independent chains of trust, which ensure that a platform CA will never accidentally sign a certificate that can be used for the wrong purpose, increasing the security posture of the cluster.
You can verify the client CA file with the following command:

```bash
for node in $(oc get nodes -ojsonpath='{.items[*].metadata.name}'); do
oc get --raw /api/v1/nodes/$node/proxy/configz | jq '.kubeletconfig.authentication.x509.clientCAFile'
done
```

Verify all the nodes are using `/etc/kubernetes/kubelet-ca.crt` as the `clientCAFile` value.

## Remediation
None. Changing the `clientCAFile` value is unsupported.

## Default Value
By default, the `clientCAFile` is set to `/etc/kubernetes/kubelet-ca.crt`.

## References
1. https://docs.openshift.com/container-platform/latest/architecture/control-plane.html#understanding-machine-config-operator_control-plane
2. https://docs.openshift.com/container-platform/latest/post_installation_configuration/machine-configuration-tasks.html#create-a-kubeletconfig-crd-to-edit-kubelet-parameters_post-install-machine-configuration-tasks
3. https://github.com/openshift/cluster-kube-apiserver-operator/blob/release-4.5/bindata/v4.1.0/config/defaultconfig.yaml#L28-L29
4. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/
5. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet-authentication-authorization/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | * | * |
| v7 | 14.8 Encrypt Sensitive Information at Rest | | | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| N/A | N/A | N/A |

## Profile
**Level 1** (Automated)
