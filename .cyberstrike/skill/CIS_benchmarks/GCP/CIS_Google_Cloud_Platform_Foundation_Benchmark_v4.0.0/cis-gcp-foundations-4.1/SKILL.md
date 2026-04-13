---
name: cis-gcp-foundations-4.1
description: "Ensure That Instances Are Not Configured To Use the Default Service Account"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, compute, virtual-machines, service-accounts]
cis_id: "4.1"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1 Ensure That Instances Are Not Configured To Use the Default Service Account (Automated)

## Profile Applicability

- Level 1

## Description

It is recommended to configure your instance to not use the default Compute Engine service account because it has the Editor role on the project.

## Rationale

When a default Compute Engine service account is created, it is automatically granted the Editor role (roles/editor) on your project which allows read and write access to most Google Cloud Services. This role includes a very large number of permissions. To defend against privilege escalations if your VM is compromised and prevent an attacker from gaining access to all of your project, you should either revoke the Editor role from the default Compute Engine service account or create a new service account and assign only the permissions needed by your instance. To mitigate this at scale, we strongly recommend that you disable the automatic role grant by adding a constraint to your organization policy.

The default Compute Engine service account is named `[PROJECT_NUMBER]-compute@developer.gserviceaccount.com`.

## Audit

### From Google Cloud Console

1. Go to the `VM instances` page by visiting: https://console.cloud.google.com/compute/instances.
2. Click on each instance name to go to its `VM instance details` page.
3. Under the section `API and identity management`, ensure that the default Compute Engine service account is not used. This account is named `[PROJECT_NUMBER]-compute@developer.gserviceaccount.com`.

### From Google Cloud CLI

1. List the instances in your project and get details on each instance:

```
gcloud compute instances list --format=json | jq -r '. | "SA: \(.[].serviceAccounts[].email) Name: \(.[].name)"'
```

2. Ensure that the service account section has an email that does not match the pattern `[PROJECT_NUMBER]-compute@developer.gserviceaccount.com`.

## Exception

VMs created by GKE should be excluded. These VMs have names that start with `gke-` and are labeled `goog-gke-node`.

## Remediation

### From Google Cloud Console

1. Go to the `VM instances` page by visiting: https://console.cloud.google.com/compute/instances.
2. Click on the instance name to go to its `VM instance details` page.
3. Click `STOP` and then click `EDIT`.
4. Under the section `API and identity management`, select a service account other than the default Compute Engine service account. You may first need to create a new service account.
5. Click `Save` and then click `START`.

### From Google Cloud CLI

1. Stop the instance:

```
gcloud compute instances stop <INSTANCE_NAME>
```

2. Update the instance:

```
gcloud compute instances set-service-account <INSTANCE_NAME> --service-account=<SERVICE_ACCOUNT>
```

3. Restart the instance:

```
gcloud compute instances start <INSTANCE_NAME>
```

## Default Value

By default, Compute instances are configured to use the default Compute Engine service account.

## References

1. https://cloud.google.com/compute/docs/access/service-accounts
2. https://cloud.google.com/compute/docs/access/create-enable-service-accounts-for-instances
3. https://cloud.google.com/sdk/gcloud/reference/compute/instances/set-service-account

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.7 Manage Default Accounts on Enterprise Assets and Software | X | X | X |
| v7 | 4.7 Limit Access to Script Tools | | X | X |
