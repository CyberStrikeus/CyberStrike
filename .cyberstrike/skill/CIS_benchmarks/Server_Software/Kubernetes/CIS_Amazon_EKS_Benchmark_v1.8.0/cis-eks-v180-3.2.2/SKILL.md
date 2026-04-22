---
name: cis-eks-v180-3.2.2
description: "Ensure that the --authorization-mode argument is not set to AlwaysAllow (Automated)"
category: cis-eks
version: "1.8.0"
author: cyberstrike-official
tags: [cis, eks, kubernetes, aws, worker-node, kubelet, authorization, webhook]
cis_id: "3.2.2"
cis_benchmark: "CIS Amazon Elastic Kubernetes Service (EKS) Benchmark v1.8.0"
tech_stack: [kubernetes, aws, eks]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.2.2 Ensure that the --authorization-mode argument is not set to AlwaysAllow (Automated)

## Profile Applicability

- Level 1

## Description

Do not allow all requests. Enable explicit authorization.

## Rationale

Kubelets can be configured to allow all authenticated requests (even anonymous ones) without needing explicit authorization checks from the apiserver. You should restrict this behavior and only allow explicitly authorized requests.

Unauthorized requests will be denied.

## Audit Procedure

**Audit Method 1:**

Kubelets can accept configuration via a configuration file and in some cases via command line arguments. It is important to note that parameters provided as command line arguments will override their counterpart parameters in the configuration file (see `--config` details in the Kubelet CLI Reference for more info).

With this in mind, it is important to check for the existence of command line arguments as well as configuration file entries when auditing Kubelet configuration.

Firstly, SSH to each node and execute the following command to find the Kubelet process:

```bash
ps -ef | grep kubelet
```

The output of the above command provides details of the active Kubelet process, from which we can see the command line arguments provided to the process. Also note the location of the configuration file, provided with the `--config` argument, as this will be needed to verify configuration. The file can be viewed with a command such as `more` or `less`, like so:

```bash
sudo less /path/to/kubelet-config.json
```

Verify that Webhook Authentication is enabled. This may be enabled as a command line argument to the kubelet service with `--authentication-token-webhook` or in the kubelet configuration file via `"authentication": { "webhook": { "enabled": true } }`.

Verify that the Authorization Mode is set to `WebHook`. This may be set as a command line argument to the kubelet service with `--authorization-mode=Webhook` or in the configuration file via `"authorization": { "mode": "Webhook" }`.

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

Verify that Webhook Authentication is enabled with `"authentication": { "webhook": { "enabled": true } }` in the API response.

Verify that the Authorization Mode is set to WebHook with `"authorization": { "mode": "Webhook" }` in the API response.

## Remediation

**Remediation Method 1:**

If configuring via the Kubelet config file, you first need to locate the file. To do this, SSH to each node and execute the following command to find the kubelet process:

```bash
ps -ef | grep kubelet
```

The output of the above command provides details of the active kubelet process, from which we can see the location of the configuration file provided to the kubelet service with the `--config` argument. The file can be viewed with a command such as `more` or `less`, like so:

```bash
sudo less /path/to/kubelet-config.json
```

Enable Webhook Authentication by setting the following parameter:

```json
"authentication": { "webhook": { "enabled": true } }
```

Next, set the Authorization Mode to Webhook by setting the following parameter:

```json
"authorization": { "mode": "Webhook" }
```

Finer detail of the `authentication` and `authorization` fields can be found in the Kubelet Configuration documentation.

**Remediation Method 2:**

If using executable arguments, edit the kubelet service file on each worker node and ensure the below parameters are part of the `KUBELET_ARGS` variable string.

For systems using systemd, such as the Amazon EKS Optimised Amazon Linux or Bottlerocket AMIs, then this file can be found at `/etc/systemd/system/kubelet.service.d/10-kubelet-args.conf`. Otherwise, you may need to look up documentation for your chosen operating system to determine which service manager is configured:

```
--authentication-token-webhook
--authorization-mode=Webhook
```

**For Both Remediation Steps:**

Based on your system, restart the kubelet service and check the service status. The following example is for operating systems using systemd, such as the Amazon EKS Optimised Amazon Linux or Bottlerocket AMIs, and invokes the `systemctl` command. If `systemctl` is not available then you will need to look up documentation for your chosen operating system to determine which service manager is configured:

```bash
systemctl daemon-reload
systemctl restart kubelet.service
systemctl status kubelet -l
```

## Default Value

See the EKS documentation for the default value.

## References

1. [https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/](https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/)
2. [https://kubernetes.io/docs/reference/access-authn-authz/kubelet-authn-authz/#kubelet-authentication](https://kubernetes.io/docs/reference/access-authn-authz/kubelet-authn-authz/#kubelet-authentication)
3. [https://kubernetes.io/docs/reference/config-api/kubelet-config.v1beta1/](https://kubernetes.io/docs/reference/config-api/kubelet-config.v1beta1/)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | X | X | X |
| v7 | 4.2 Change Default Passwords | X | X | X |
