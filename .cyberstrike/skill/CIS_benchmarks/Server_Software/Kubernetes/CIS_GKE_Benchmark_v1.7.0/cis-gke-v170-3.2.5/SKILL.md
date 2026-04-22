---
name: cis-gke-v170-3.2.5
description: "Ensure that the --streaming-connection-idle-timeout argument is not set to 0 (Automated)"
category: cis-gke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, kubelet, authentication, authorization, tls, event-capture, certificate-rotation]
cis_id: "3.2.5"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.7.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.2.5 Ensure that the --streaming-connection-idle-timeout argument is not set to 0 (Automated)

## Profile Applicability

- Level 1

## Description

Do not disable timeouts on streaming connections.

## Rationale

Setting idle timeouts ensures that you are protected against Denial-of-Service attacks, inactive connections and running out of ephemeral ports.

Note: By default, `--streaming-connection-idle-timeout` is set to 4 hours which might be too high for your environment. Setting this as appropriate would additionally ensure that such streaming connections are timed out after serving legitimate use cases.

## Impact

Long-lived connections could be interrupted.

## Audit

**Audit Method 1:**

First, SSH to the relevant node.

Run the following command on each node to find the running kubelet process:

```bash
ps -ef | grep kubelet
```

If the command line for the process includes the argument `streaming-connection-idle-timeout` verify that it is not set to 0.

If the `streaming-connection-idle-timeout` argument is not present in the output of the above command, refer instead to the `config` argument that specifies the location of the Kubelet config file e.g. `--config /etc/kubernetes/kubelet-config.yaml`.

Open the Kubelet config file:

```bash
cat /etc/kubernetes/kubelet-config.yaml
```

Verify that the `streamingConnectionIdleTimeout` argument is not set to `0`.

**Audit Method 2:**

If using the api configz endpoint consider searching for the status of `"streamingConnectionIdleTimeout":"4h0m0s"` by extracting the live configuration from the nodes running kubelet.

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

If modifying the Kubelet config file, edit the kubelet-config.json file `/etc/kubernetes/kubelet-config.yaml` and set the below parameter to a non-zero value in the format of #h#m#s

```json
"streamingConnectionIdleTimeout": "4h0m0s"
```

You should ensure that the kubelet service file `/etc/systemd/system/kubelet.service.d/10-kubelet-args.conf` does not specify a `--streaming-connection-idle-timeout` argument because it would override the Kubelet config file.

**Remediation Method 2:**

If using executable arguments, edit the kubelet service file `/etc/systemd/system/kubelet.service.d/10-kubelet-args.conf` on each worker node and add the below parameter at the end of the `KUBELET_ARGS` variable string.

```
--streaming-connection-idle-timeout=4h0m0s
```

**Remediation Method 3:**

If using the api configz endpoint consider searching for the status of `"streamingConnectionIdleTimeout":` by extracting the live configuration from the nodes running kubelet.

\*\*See detailed step-by-step configmap procedures in Reconfigure a Node's Kubelet in a Live Cluster, and then rerun the curl statement from audit process to check for kubelet configuration changes

```bash
kubectl proxy --port=8001 &

export HOSTNAME_PORT=localhost:8001 (example host and port number)
export NODE_NAME=gke-cluster-1-pool1-5e572947-r2hg (example node name from "kubectl get nodes")

curl -sSL "http://${HOSTNAME_PORT}/api/v1/nodes/${NODE_NAME}/proxy/configz"
```

**For all three remediations:**

Based on your system, restart the `kubelet` service and check status

```bash
systemctl daemon-reload
systemctl restart kubelet.service
systemctl status kubelet -l
```

## Default Value

See the GKE documentation for the default value.

## References

1. https://kubernetes.io/docs/admin/kubelet/
2. https://github.com/kubernetes/kubernetes/pull/18552

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | **12.6 Use of Secure Network Management and Communication Protocols** - Use secure network management and communication protocols (e.g., 802.1X, Wi-Fi Protected Access 2 (WPA2) Enterprise or greater).          |      |      |      |
| v7               | **9.2 Ensure Only Approved Ports, Protocols and Services Are Running** - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system. |      |      |      |
