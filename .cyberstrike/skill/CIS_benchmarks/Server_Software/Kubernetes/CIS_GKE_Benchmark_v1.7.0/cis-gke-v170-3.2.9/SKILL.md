---
name: cis-gke-v170-3.2.9
description: "Ensure that the RotateKubeletServerCertificate argument is set to true (Automated)"
category: cis-gke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, kubelet, authentication, authorization, tls, event-capture, certificate-rotation]
cis_id: "3.2.9"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.7.0"
tech_stack: [kubernetes, gcp, gke]
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

`RotateKubeletServerCertificate` causes the kubelet to both request a serving certificate after bootstrapping its client credentials and rotate the certificate as its existing credentials expire. This automated periodic rotation ensures that the there are no downtimes due to expired certificates and thus addressing availability in the CIA (Confidentiality, Integrity, and Availability) security triad.

Note: This recommendation only applies if you let kubelets get their certificates from the API server. In case your kubelet certificates come from an outside authority/tool (e.g. Vault) then you need to implement rotation yourself.

## Impact

None

## Audit

**Audit Method 1:**

First, SSH to each node.

Run the following command to find the Kubelet process:

```bash
ps -ef | grep kubelet
```

If the output of the command above includes the `--rotate-kubelet-server-certificate` executable argument verify that it is set to true.

If the process does not have the `--rotate-kubelet-server-certificate` executable argument then check the Kubelet config file. The output of the above command should return something similar to `--config /etc/kubernetes/kubelet-config.yaml` which is the location of the Kubelet config file.

Open the Kubelet config file:

```bash
cat /etc/kubernetes/kubelet-config.yaml
```

Verify that `RotateKubeletServerCertificate` argument exists in the `featureGates` section and is set to `true`.

**Audit Method 2:**

If using the api configz endpoint consider searching for the status of `"RotateKubeletServerCertificate":true` by extracting the live configuration from the nodes running kubelet.

Set the local proxy port and the following variables and provide proxy port number and node name;

```
HOSTNAME_PORT="localhost-and-port-number"
NODE_NAME="The-Name-Of-Node-To-Extract-Configuration" from the output of "kubectl get nodes"
```

```bash
kubectl proxy --port=8001 &

export HOSTNAME_PORT=localhost:8001 (example host and port number)
export NODE_NAME=gke-cluster-1-pool1-5e572947-r2hg (example node name from "kubectl get nodes")

curl -sSL "http://${HOSTNAME_PORT}/api/v1/nodes/${NODE_NAME}/proxy/configz"
```

## Remediation

**Remediation Method 1:**

If modifying the Kubelet config file, edit the kubelet-config.json file `/etc/kubernetes/kubelet-config.yaml` and set the below parameter to true

```json
"featureGates": {
  "RotateKubeletServerCertificate":true
},
```

Additionally, ensure that the kubelet service file `/etc/systemd/system/kubelet.service.d/10-kubelet-args.conf` does not set the `--rotate-kubelet-server-certificate` executable argument to false because this would override the Kubelet config file.

**Remediation Method 2:**

If using executable arguments, edit the kubelet service file `/etc/systemd/system/kubelet.service.d/10-kubelet-args.conf` on each worker node and add the below parameter at the end of the `KUBELET_ARGS` variable string.

```
--rotate-kubelet-server-certificate=true
```

**Remediation Method 3:**

If using the api configz endpoint consider searching for the status of `"RotateKubeletServerCertificate":` by extracting the live configuration from the nodes running kubelet.

**See detailed step-by-step configmap procedures in Reconfigure a Node's Kubelet in a Live Cluster, and then rerun the curl statement from audit process to check for kubelet configuration changes

```bash
kubectl proxy --port=8001 &

export HOSTNAME_PORT=localhost:8001 (example host and port number)
export NODE_NAME=gke-cluster-1-pool1-5e572947-r2hg (example node name from "kubectl get nodes")

curl -sSL "http://${HOSTNAME_PORT}/api/v1/nodes/${NODE_NAME}/proxy/configz"
```

**For all three remediation methods:**

Restart the `kubelet` service and check status. The example below is for when using systemctl to manage services:

```bash
systemctl daemon-reload
systemctl restart kubelet.service
systemctl status kubelet -l
```

## Default Value

See the GKE documentation for the default value.

## References

1. https://github.com/kubernetes/kubernetes/pull/45059
2. https://kubernetes.io/docs/admin/kubelet-tls-bootstrapping/#kubelet-configuration

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | **3.10 Encrypt Sensitive Data in Transit** - Encrypt sensitive data in transit. Example implementations can include: Transport Layer Security (TLS) and Open Secure Shell (OpenSSH). | | | |
| v7 | **14.4 Encrypt All Sensitive Information in Transit** - Encrypt all sensitive information in transit. | | | |
