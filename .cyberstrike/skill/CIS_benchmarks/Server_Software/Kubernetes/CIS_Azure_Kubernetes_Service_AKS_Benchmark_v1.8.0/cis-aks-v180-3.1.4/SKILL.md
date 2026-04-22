---
name: cis-aks-v180-3.1.4
description: "Ensure that the azure.json file ownership is set to root:root (Automated)"
category: cis-aks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, aks, kubernetes, azure, worker-node, file-ownership, azure-json]
cis_id: "3.1.4"
cis_benchmark: "CIS Azure Kubernetes Service (AKS) Benchmark v1.8.0"
tech_stack: [kubernetes, azure, aks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.4 Ensure that the azure.json file ownership is set to root:root (Automated)

## Profile Applicability

- Level 1

## Description

The azure.json file in an Azure Kubernetes Service (AKS) cluster is a configuration file used by the Kubernetes cloud provider integration for Azure. This file contains essential details that allow the Kubernetes cluster to interact with Azure resources effectively. It's part of the Azure Cloud Provider configuration, enabling Kubernetes components to communicate with Azure services for features like load balancers, storage, and networking.

Ensure that the file is owned by root:root.

## Rationale

The azure.json file in AKS structure typically includes:

- Tenant ID: The Azure Tenant ID where the AKS cluster resides.
- Subscription ID: The Azure Subscription ID used for billing and resource management.
- AAD Client ID: The Azure Active Directory (AAD) application client ID used by the Kubernetes cloud provider to interact with Azure resources.
- AAD Client Secret: The secret for the AAD application.
- Resource Group: The name of the resource group where the AKS cluster resources are located.
- Location: The Azure region where the AKS cluster is deployed.
- VM Type: Specifies the type of VMs used by the cluster (e.g., standard VMs or Virtual Machine Scale Sets).
- Subnet Name, Security Group Name, Vnet Name, and Vnet Resource Group: Networking details for the cluster.
- Route Table Name: The name of the route table for the cluster.
- Storage Account Type: The default type of storage account to use for Kubernetes persistent volumes.

## Impact

None

## Audit Procedure

**Method 1**

First, SSH to the relevant worker node.

To check to see if the Kubelet Service is running:

```bash
sudo systemctl status kubelet
```

The output should return `Active: active (running) since..`.

Run the following command on each node to find the appropriate Kubelet config file:

```bash
ps -ef | grep kubelet
```

The output of the above command should return something similar to `--config /etc/kubernetes/azure.json` which is the location of the Kubelet config file.

Run the following command:

```bash
stat -c %U:%G /etc/kubernetes/azure.json
```

The output of the above command is the Kubelet config file's ownership. Verify that the ownership is set to `root:root`.

**Method 2**

Create and Run a Privileged Pod.

You will need to run a pod that is privileged enough to access the host's file system. This can be achieved by deploying a pod that uses the hostPath volume to mount the node's file system into the pod.

Here's an example of a simple pod definition that mounts the root of the host to /host within the pod:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: file-check
spec:
  volumes:
    - name: host-root
      hostPath:
        path: /
        type: Directory
  containers:
    - name: nsenter
      image: busybox
      command: ["sleep", "3600"]
      volumeMounts:
        - name: host-root
          mountPath: /host
      securityContext:
        privileged: true
```

Save this to a file (e.g., file-check-pod.yaml) and create the pod:

```bash
kubectl apply -f file-check-pod.yaml
```

Once the pod is running, you can exec into it to check file ownership on the node:

```bash
kubectl exec -it file-check -- sh
```

Now you are in a shell inside the pod, but you can access the node's file system through the /host directory and check the ownership of the file:

```bash
ls -l /host/etc/kubernetes/azure.json
```

The output of the above command gives you the azure.json file's ownership. Verify that the ownership is set to `root:root`.

## Remediation

Run the following command (using the config file location identified in the Audit step):

```bash
chown root:root /etc/kubernetes/azure.json
```

## Default Value

See the Azure AKS documentation for the default value.

## References

1. https://kubernetes.io/docs/admin/kube-proxy/
2. https://docs.microsoft.com/security/benchmark/azure/security-controls-v2-posture-vulnerability-management#pv-3-establish-secure-configurations-for-compute-resources

## CIS Controls

| Controls Version | Control                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists | X    | X    | X    |
| v7               | 5.2 Maintain Secure Images              |      | X    | X    |
