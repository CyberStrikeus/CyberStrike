---
name: cis-gke-v170-3.1.2
description: "Ensure that the proxy kubeconfig file ownership is set to root:root (Automated)"
category: cis-gke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, worker-nodes, configuration-files, permissions, ownership, kubeconfig, kubelet]
cis_id: "3.1.2"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.7.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.2 Ensure that the proxy kubeconfig file ownership is set to root:root (Automated)

## Profile Applicability

- Level 1

## Description

If `kube-proxy` is running, ensure that the file ownership of its kubeconfig file is set to `root:root`.

## Rationale

The kubeconfig file for `kube-proxy` controls various parameters for the `kube-proxy` service in the worker node. You should set its file ownership to maintain the integrity of the file. The file should be owned by `root:root`.

## Impact

Overly permissive file access increases the security risk to the platform.

## Audit

**Using Google Cloud Console**

1. Go to Kubernetes Engine by visiting https://console.cloud.google.com/kubernetes/list
2. Click on the desired cluster to open the Details page, then click on the desired Node pool to open the Node pool Details page
3. Note the name of the desired node
4. Go to VM Instances by visiting https://console.cloud.google.com/compute/instances
5. Find the desired node and click on 'SSH' to open an SSH connection to the node.

**Using Command Line**

**Method 1**

SSH to the worker nodes.

To check to see if the Kubelet Service is running:

```bash
sudo systemctl status kubelet
```

The output should return `Active: active (running) since..`.

Run the following command on each node to find the appropriate kubeconfig file:

```bash
ps -ef | grep kubelet
```

The output of the above command should return something similar to `--kubeconfig /var/lib/kubelet/kubeconfig` which is the location of the kubeconfig file.

Run this command to obtain the kubeconfig file ownership:

```bash
stat -c %U:%G /var/lib/kubelet/kubeconfig
```

The output of the above command gives you the kubeconfig file's ownership. Verify that the ownership is set to `root:root`.

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
ls -l /host/var/lib/kubelet/kubeconfig
```

The output of the above command gives you the kubeconfig file's ownership. Verify that the ownership is set to `root:root`.

## Remediation

Run the below command (based on the file location on your system) on each worker node. For example,

```bash
chown root:root <proxy kubeconfig file>
```

## Default Value

The default ownership of the proxy kubeconfig file is root:root.

## References

1. https://kubernetes.io/docs/admin/kube-proxy/
2. https://cloud.google.com/kubernetes-engine/docs/concepts/cis-benchmarks

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | **3.3 Configure Data Access Control Lists** - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | | | |
| v7 | **5.2 Maintain Secure Images** - Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates. | | | |
