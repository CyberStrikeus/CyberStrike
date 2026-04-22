---
name: cis-aks-v170-3.2.1
description: "Ensure that the --anonymous-auth argument is set to false (Automated)"
category: cis-aks
version: "1.7.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, kubelet, authentication, anonymous-auth]
cis_id: "3.2.1"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.7.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.2.1 Ensure that the --anonymous-auth argument is set to false (Automated)

## Profile Applicability

- Level 1

## Description

Disable anonymous requests to the Kubelet server.

## Rationale

When enabled, requests that are not rejected by other configured authentication methods are treated as anonymous requests. These requests are then served by the Kubelet server. You should rely on authentication to authorize access and disallow anonymous requests.

## Impact

Anonymous requests will be rejected.

## Audit Procedure

**Audit Method 1:**

If using a Kubelet configuration file, check that there is an entry for `authentication: anonymous: enabled` set to `false`.

First, SSH to the relevant node:

Run the following command on each node to find the appropriate Kubelet config file:

```bash
ps -ef | grep kubelet
```

The output of the above command should return something similar to `--config /etc/kubernetes/kubelet/kubelet-config.json` which is the location of the Kubelet config file.

Open the Kubelet config file:

```bash
sudo more /etc/kubernetes/kubelet/kubelet-config.json
```

Verify that the `"authentication": { "anonymous": { "enabled": false }` argument is set to `false`.

**Audit Method 2:**

If using the api configz endpoint consider searching for the status of `authentication... "anonymous":{"enabled":false}` by extracting the live configuration from the nodes running kubelet.

Set the local proxy port and the following variables and provide proxy port number and node name; `HOSTNAME_PORT="localhost-and-port-number"` `NODE_NAME="The-Name-Of-Node-To-Extract-Configuration"` from the output of `kubectl get nodes`

```bash
kubectl proxy --port=8001 &

export HOSTNAME_PORT=localhost:8001 (example host and port number)
export NODE_NAME=ip-192.168.31.226.aks.internal (example node name from "kubectl get nodes")

curl -sSL "http://${HOSTNAME_PORT}/api/v1/nodes/${NODE_NAME}/proxy/configz"
```

## Remediation

**Remediation Method 1:**

If modifying the Kubelet config file, edit the kubelet-config.json file `/etc/kubernetes/kubelet/kubelet-config.json` and set the below parameter to false:

```json
"anonymous": "enabled": false
```

**Remediation Method 2:**

If using executable arguments, edit the kubelet service file `/etc/systemd/system/kubelet.service.d/10-kubelet-args.conf` on each worker node and add the below parameter at the end of the `KUBELET_ARGS` variable string.

```
--anonymous-auth=false
```

**Remediation Method 3:**

If using the api configz endpoint consider searching for the status of `"authentication.*anonymous":{"enabled":false}"` by extracting the live configuration from the nodes running kubelet.

**See detailed step-by-step configmap procedures in [Reconfigure a Node's Kubelet in a Live Cluster](https://kubernetes.io/docs/tasks/administer-cluster/reconfigure-kubelet/), and then rerun the curl statement from audit process to check for kubelet configuration changes.

```bash
kubectl proxy --port=8001 &

export HOSTNAME_PORT=localhost:8001 (example host and port number)
export NODE_NAME=ip-192.168.31.226.aks.internal (example node name from "kubectl get nodes")

curl -sSL "http://${HOSTNAME_PORT}/api/v1/nodes/${NODE_NAME}/proxy/configz"
```

**For all three remediations:** Based on your system, restart the `kubelet` service and check status:

```bash
systemctl daemon-reload
systemctl restart kubelet.service
systemctl status kubelet -l
```

## Default Value

See the Azure AKS documentation for the default value.

## References

1. https://kubernetes.io/docs/admin/kubelet/
2. https://kubernetes.io/docs/admin/kubelet-authentication-authorization/#kubelet-authentication
3. https://kubernetes.io/docs/tasks/administer-cluster/reconfigure-kubelet/
4. https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-governance-strategy#gs-6-define-identity-and-privileged-access-strategy

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 6 Access Control Management | | | |
| v7 | 14 Controlled Access Based on the Need to Know | | | |
