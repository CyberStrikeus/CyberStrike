---
name: cis-gke-v170-3.2.3
description: "Ensure that a Client CA File is Configured (Automated)"
category: cis-gke
version: "1.7.0"
author: cyberstrike-official
tags: [cis, gke, kubernetes, gcp, kubelet, authentication, authorization, tls, event-capture, certificate-rotation]
cis_id: "3.2.3"
cis_benchmark: "CIS Google Kubernetes Engine (GKE) Benchmark v1.7.0"
tech_stack: [kubernetes, gcp, gke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.2.3 Ensure that a Client CA File is Configured (Automated)

## Profile Applicability

- Level 1

## Description

Enable Kubelet authentication using certificates.

## Rationale

The connections from the apiserver to the kubelet are used for fetching logs for pods, attaching (through kubectl) to running pods, and using the kubelet's port-forwarding functionality. These connections terminate at the kubelet's HTTPS endpoint. By default, the apiserver does not verify the kubelet's serving certificate, which makes the connection subject to man-in-the-middle attacks, and unsafe to run over untrusted and/or public networks. Enabling Kubelet certificate authentication ensures that the apiserver could authenticate the Kubelet before submitting any requests.

## Impact

You require TLS to be configured on apiserver as well as kubelets.

## Audit

**Audit Method 1:**

Kubelets can accept configuration via a configuration file and in some cases via command line arguments. It is important to note that parameters provided as command line arguments will override their counterpart parameters in the configuration file (see `--config` details in the Kubelet CLI Reference for more info, where you can also find out which configuration parameters can be supplied as a command line argument).

With this in mind, it is important to check for the existence of command line arguments as well as configuration file entries when auditing Kubelet configuration.

Firstly, SSH to each node and execute the following command to find the Kubelet process:

```bash
ps -ef | grep kubelet
```

The output of the above command provides details of the active Kubelet process, from which we can see the command line arguments provided to the process. Also note the location of the configuration file, provided with the `--config` argument, as this will be needed to verify configuration. The file can be viewed with a command such as `more` or `less`, like so:

```bash
sudo less /path/to/kubelet-config.json
```

Verify that a client certificate authority file is configured. This may be configured using a command line argument to the kubelet service with `--client-ca-file` or in the kubelet configuration file via `"authentication": { "x509": {"clientCAFile": <path/to/client-ca-file> } }"`.

**Audit Method 2:**

It is also possible to review the running configuration of a Kubelet via the /configz endpoint of the Kubernetes API. This can be achieved using `kubectl` to proxy your requests to the API.

Discover all nodes in your cluster by running the following command:

```bash
kubectl get nodes
```

Next, initiate a proxy with kubectl on a local port of your choice. In this example we will use 8080:

```bash
kubectl proxy --port=8080
```

With this running, in a separate terminal run the following command for each node:

```bash
export NODE_NAME=my-node-name
curl http://localhost:8080/api/v1/nodes/${NODE_NAME}/proxy/configz
```

The curl command will return the API response which will be a JSON formatted string representing the Kubelet configuration.

Verify that a client certificate authority file is configured with `"authentication": { "x509": {"clientCAFile": <path/to/client-ca-file> } }"` in the API response.

## Remediation

**Remediation Method 1:**

If configuring via the Kubelet config file, you first need to locate the file.

To do this, SSH to each node and execute the following command to find the kubelet process:

```bash
ps -ef | grep kubelet
```

The output of the above command provides details of the active kubelet process, from which we can see the location of the configuration file provided to the kubelet service with the `--config` argument. The file can be viewed with a command such as `more` or `less`, like so:

```bash
sudo less /path/to/kubelet-config.json
```

Configure the client certificate authority file by setting the following parameter appropriately:

```json
"authentication": { "x509": {"clientCAFile": <path/to/client-ca-file> } }"
```

**Remediation Method 2:**

If using executable arguments, edit the kubelet service file on each worker node and ensure the below parameters are part of the `KUBELET_ARGS` variable string.

For systems using `systemd`, such as the Amazon EKS Optimised Amazon Linux or Bottlerocket AMIs, then this file can be found at `/etc/systemd/system/kubelet.service.d/10-kubelet-args.conf`. Otherwise, you may need to look up documentation for your chosen operating system to determine which service manager is configured:

```
--client-ca-file=<path/to/client-ca-file>
```

**For Both Remediation Steps:**

Based on your system, restart the `kubelet` service and check the service status. The following example is for operating systems using `systemd`, such as the Amazon EKS Optimised Amazon Linux or Bottlerocket AMIs, and invokes the `systemctl` command. If `systemctl` is not available then you will need to look up documentation for your chosen operating system to determine which service manager is configured:

```bash
systemctl daemon-reload
systemctl restart kubelet.service
systemctl status kubelet -l
```

## Default Value

See the GKE documentation for the default value.

## References

1. https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/
2. https://kubernetes.io/docs/reference/access-authn-authz/kubelet-authn-authz/#kubelet-authentication
3. https://kubernetes.io/docs/reference/config-api/kubelet-config.v1beta1/

## CIS Controls

| Controls Version | Control                                                                                                                                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | **3.10 Encrypt Sensitive Data in Transit** - Encrypt sensitive data in transit. Example implementations can include: Transport Layer Security (TLS) and Open Secure Shell (OpenSSH). |      |      |      |
| v7               | **14.4 Encrypt All Sensitive Information in Transit** - Encrypt all sensitive information in transit.                                                                                |      |      |      |
