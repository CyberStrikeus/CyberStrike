---
name: cis-eks-v160-3.1.3
description: "Ensure that the kubelet configuration file has permissions set to 644 or more restrictive (Automated)"
category: cis-eks
version: "1.6.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, worker-node, configuration-files, file-permissions, kubelet]
cis_id: "3.1.3"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.6.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.3 Ensure that the kubelet configuration file has permissions set to 644 or more restrictive (Automated)

## Profile Applicability

- Level 1

## Description

Ensure that if the kubelet refers to a configuration file with the `--config` argument, that file has permissions of 644 or more restrictive.

## Rationale

The kubelet reads various parameters, including security settings, from a config file specified by the `--config` argument. If this file is specified you should restrict its file permissions to maintain the integrity of the file. The file should be writable by only the administrators on the system.

## Audit Procedure

**Method 1 - SSH to the relevant worker node:**

To check to see if the Kubelet Service is running:

```bash
sudo systemctl status kubelet
```

The output should return `Active: active (running) since..`.

Run the following command on each node to find the appropriate Kubelet config file:

```bash
ps -ef | grep kubelet
```

The output of the above command should return something similar to `--config /etc/kubernetes/kubelet/config.json` which is the location of the Kubelet config file.

Run the following command:

```bash
stat -c %a /etc/kubernetes/kubelet/config.json
```

The output of the above command is the Kubelet config file's permissions. Verify that the permissions are `644` or more restrictive.

**Method 2 - Create and Run a Privileged Pod:**

You will need to run a pod that is privileged enough to access the host's file system. This can be achieved by deploying a pod that uses the hostPath volume to mount the node's file system into the pod.

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
ls -l /host/etc/kubernetes/kubelet/config.json
```

Verify that if a file is specified and it exists, the permissions are `644` or more restrictive.

## Remediation

Run the following command (using the config file location identified in the Audit step):

```bash
chmod 644 /etc/kubernetes/kubelet/config.json
```

## Default Value

See the AWS EKS documentation for the default value.

## References

1. [https://kubernetes.io/docs/tasks/administer-cluster/kubelet-config-file/](https://kubernetes.io/docs/tasks/administer-cluster/kubelet-config-file/)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | X | X | X |
| v7 | 5.2 Maintain Secure Images | | X | X |
