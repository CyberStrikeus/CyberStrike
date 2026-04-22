---
name: cis-gke-v170-3.2.6
description: "Ensure that the --make-iptables-util-chains argument is set to true (Automated)"
category: cis-gke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, kubelet, authentication, authorization, tls, event-capture, certificate-rotation]
cis_id: "3.2.6"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.7.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.2.6 Ensure that the --make-iptables-util-chains argument is set to true (Automated)

## Profile Applicability

- Level 1

## Description

Allow Kubelet to manage iptables.

## Rationale

Kubelets can automatically manage the required changes to iptables based on how you choose your networking options for the pods. It is recommended to let kubelets manage the changes to iptables. This ensures that the iptables configuration remains in sync with pods networking configuration. Manually configuring iptables with dynamic pod network configuration changes might hamper the communication between pods/containers and to the outside world. You might have iptables rules too restrictive or too open.

## Impact

Kubelet would manage the iptables on the system and keep it in sync. If you are using any other iptables management solution, then there might be some conflicts.

## Audit

**Audit Method 1:**

First, SSH to each node.

Run the following command on each node to find the Kubelet process:

```bash
ps -ef | grep kubelet
```

If the output of the above command includes the argument `--make-iptables-util-chains` then verify it is set to true.

If the `--make-iptables-util-chains` argument does not exist, and there is a Kubelet config file specified by `--config`, verify that the file does not set `makeIPTablesUtilChains` to `false`.

**Audit Method 2:**

If using the api configz endpoint consider searching for the status of `authentication... "makeIPTablesUtilChains.:true` by extracting the live configuration from the nodes running kubelet.

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

If modifying the Kubelet config file, edit the kubelet-config.json file `/etc/kubernetes/kubelet/kubelet-config.json` and set the below parameter to true

```json
"makeIPTablesUtilChains": true
```

Ensure that `/etc/systemd/system/kubelet.service.d/10-kubelet-args.conf` does not set the `--make-iptables-util-chains` argument because that would override your Kubelet config file.

**Remediation Method 2:**

If using executable arguments, edit the kubelet service file `/etc/systemd/system/kubelet.service.d/10-kubelet-args.conf` on each worker node and add the below parameter at the end of the `KUBELET_ARGS` variable string.

```
--make-iptables-util-chains:true
```

**Remediation Method 3:**

If using the api configz endpoint consider searching for the status of `"makeIPTablesUtilChains.: true` by extracting the live configuration from the nodes running kubelet.

**See detailed step-by-step configmap procedures in Reconfigure a Node's Kubelet in a Live Cluster, and then rerun the curl statement from audit process to check for kubelet configuration changes

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
2. https://kubernetes.io/docs/tasks/administer-cluster/reconfigure-kubelet/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | **12.3 Securely Manage Network Infrastructure** - Securely manage network infrastructure. Example implementations include version-controlled-infrastructure-as-code, and the use of secure network protocols, such as SSH and HTTPS. | | | |
| v7 | **11.1 Maintain Standard Security Configurations for Network Devices** - Maintain standard, documented security configuration standards for all authorized network devices. | | | |
