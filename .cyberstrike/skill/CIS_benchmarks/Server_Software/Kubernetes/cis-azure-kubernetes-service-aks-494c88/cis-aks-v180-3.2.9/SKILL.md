---
name: cis-aks-v180-3.2.9
description: "Ensure that the RotateKubeletServerCertificate argument is set to true (Automated)"
category: cis-aks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, kubelet, certificate-rotation, server-certificate]
cis_id: "3.2.9"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.2.9 Ensure that the RotateKubeletServerCertificate argument is set to true (Automated)

## Profile Applicability

- Level 1

## Description

Enable kubelet server certificate rotation.

## Rationale

`RotateKubeletServerCertificate` causes the kubelet to both request a serving certificate after bootstrapping its client credentials and rotate the certificate as its existing credentials expire. This automated periodic rotation ensures that the there are no downtimes due to expired certificates and thus addressing availability in the CIA security triad.

Note: This recommendation only applies if you let kubelets get their certificates from the API server. In case your kubelet certificates come from an outside authority/tool (e.g. Vault) then you need to take care of rotation yourself.

## Impact

None

## Audit Procedure

**Audit Method 1:**

If using a Kubelet configuration file, check that there is an entry for `RotateKubeletServerCertificate` is set to `true`.

First, SSH to the relevant node:

Run the following command on each node to find the appropriate Kubelet config file:

```bash
ps -ef | grep kubelet
```

The output of the above command should return something similar to `--config /etc/kubernetes/kubelet/kubelet-config.json` which is the location of the Kubelet config file.

Open the Kubelet config file:

```bash
cat /etc/kubernetes/kubelet/kubelet-config.json
```

Verify that `RotateKubeletServerCertificate` argument exists and is set to `true`.

**Audit Method 2:**

If using the api configz endpoint consider searching for the status of `"RotateKubeletServerCertificate":true` by extracting the live configuration from the nodes running kubelet.

Set the local proxy port and the following variables and provide proxy port number and node name; `HOSTNAME_PORT="localhost-and-port-number"` `NODE_NAME="The-Name-Of-Node-To-Extract-Configuration"` from the output of `kubectl get nodes`

```bash
kubectl proxy --port=8001 &

export HOSTNAME_PORT=localhost:8001 (example host and port number)
export NODE_NAME=ip-192.168.31.226.aks.internal (example node name from "kubectl get nodes")

curl -sSL "http://${HOSTNAME_PORT}/api/v1/nodes/${NODE_NAME}/proxy/configz"
```

## Remediation

**Remediation Method 1:**

If modifying the Kubelet config file, edit the kubelet-config.json file `/etc/kubernetes/kubelet/kubelet-config.json` and set the below parameter to true:

```json
"RotateKubeletServerCertificate":true
```

**Remediation Method 2:**

If using a Kubelet config file, edit the file to set `RotateKubeletServerCertificate` to `true`.

If using executable arguments, edit the kubelet service file `/etc/systemd/system/kubelet.service.d/10-kubelet-args.conf` on each worker node and add the below parameter at the end of the `KUBELET_ARGS` variable string.

```
--rotate-kubelet-server-certificate=true
```

**Remediation Method 3:**

If using the api configz endpoint consider searching for the status of `"RotateKubeletServerCertificate":` by extracting the live configuration from the nodes running kubelet.

\*\*See detailed step-by-step configmap procedures in [Reconfigure a Node's Kubelet in a Live Cluster](https://kubernetes.io/docs/tasks/administer-cluster/reconfigure-kubelet/), and then rerun the curl statement from audit process to check for kubelet configuration changes.

## Default Value

See the Azure AKS documentation for the default value.

## References

1. https://github.com/kubernetes/kubernetes/pull/41912
2. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet-tls-bootstrapping/#kubelet-configuration
3. https://kubernetes.io/docs/imported/release/notes/
4. https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/
5. https://kubernetes.io/docs/tasks/administer-cluster/reconfigure-kubelet/
6. https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-data-protection#dp-4-encrypt-sensitive-information-in-transit

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit            |      | X    | X    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit |      | X    | X    |
