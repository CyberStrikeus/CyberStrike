---
name: cis-gke-v180-3.1.1
description: "Ensure that the kubeconfig file permissions are set to 644 or more restrictive (Automated)"
category: cis-gke
version: "1.8.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, worker-nodes, configuration-files, permissions, kubeconfig, kubelet]
cis_id: "3.1.1"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.8.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.1 Ensure that the kubeconfig file permissions are set to 644 or more restrictive (Automated)

## Profile Applicability

- Level 1

## Description

If `kubelet` is running, and if it is configured by a kubeconfig file, ensure that the proxy kubeconfig file has permissions of 644 or more restrictive.

## Rationale

The `kubelet` kubeconfig file controls various parameters of the `kubelet` service in the worker node. You should restrict its file permissions to maintain the integrity of the file. The file should be writable by only the administrators on the system.

It is possible to run `kubelet` with the kubeconfig parameters configured as a Kubernetes ConfigMap instead of a file. In this case, there is no proxy kubeconfig file.

## Impact

Ensuring that the kubeconfig file permissions are set to 644 or more restrictive significantly strengthens the security posture of the Kubernetes environment by preventing unauthorized modifications. This restricts write access to the kubeconfig file, ensuring only administrators can alter crucial kubelet configurations, thereby reducing the risk of malicious alterations that could compromise the cluster's integrity.

However, this configuration may slightly impact usability, as it limits the ability for non-administrative users to make quick adjustments to the kubelet settings. Administrators will need to balance security needs with operational flexibility, potentially requiring adjustments to workflows for managing kubelet configurations.

## Audit

### Using Google Cloud Console

1. Go to Kubernetes Engine by visiting https://console.cloud.google.com/kubernetes/list
2. Click on the desired cluster to open the Details page, then click on the desired Node pool to open the Node pool Details page
3. Note the name of the desired node
4. Go to VM Instances by visiting https://console.cloud.google.com/compute/instances
5. Find the desired node and click on 'SSH' to open an SSH connection to the node.

### Using Command Line

**Method 1**

SSH to the worker nodes.
To check to see if the kubelet service is running:

```bash
sudo systemctl status kubelet
```

The output should return `Active: active (running) since..`.

Run the following command on each node to find the appropriate kubeconfig file:

```bash
ps -ef | grep kubelet
```

The output of the above command should return something similar to `--kubeconfig /var/lib/kubelet/kubeconfig` which is the location of the kubeconfig file.

Run this command to obtain the kubeconfig file permissions:

```bash
stat -c %a /var/lib/kubelet/kubeconfig
```

The output of the above command gives you the kubeconfig file's permissions. Verify that if a file is specified and it exists, the permissions are `644` or more restrictive.

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

Once the pod is running, you can exec into it to check file permissions on the node:

```bash
kubectl exec -it file-check -- sh
```

Now you are in a shell inside the pod, but you can access the node's file system through the /host directory and check the permission level of the file:

```bash
ls -l /host/var/lib/kubelet/kubeconfig
```

Verify that if a file is specified and it exists, the permissions are `644` or more restrictive.

## Remediation

Run the below command (based on the file location on your system) on the each worker node. For example,

```bash
chmod 644 <kubeconfig file>
```

## Default Value

See the GKE documentation for the default value.

## References

1. https://cloud.google.com/kubernetes-engine/docs/concepts/cis-benchmarks

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | **3.3 Configure Data Access Control Lists** - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                 | X    | X    | X    |
| v8               | **13.4 Perform Traffic Filtering Between Network Segments** - Perform traffic filtering between network segments, where appropriate.                                                                                                                                                                |      | X    | X    |
| v8               | **13.6 Collect Network Traffic Flow Logs** - Collect network traffic flow logs and/or network traffic to review and alert upon from network devices.                                                                                                                                                |      | X    | X    |
| v7               | **5.2 Maintain Secure Images** - Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates. |      | X    | X    |
