---
name: cis-gcp-foundations-4.4
description: "Ensure Oslogin Is Enabled for a Project"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, compute, virtual-machines, oslogin]
cis_id: "4.4"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.4 Ensure Oslogin Is Enabled for a Project (Automated)

## Profile Applicability

- Level 1

## Description

Enabling OS login binds SSH certificates to IAM users and facilitates effective SSH certificate management.

## Rationale

Enabling osLogin ensures that SSH keys used to connect to instances are mapped with IAM users. Revoking access to IAM user will revoke all the SSH keys associated with that particular user. It facilitates centralized and automated SSH key pair management which is useful in handling cases like response to compromised SSH key pairs and/or revocation of external/third-party/Vendor users.

## Impact

Enabling OS Login on project disables metadata-based SSH key configurations on all instances from a project. Disabling OS Login restores SSH keys that you have configured in project or instance meta-data.

## Audit

### From Google Cloud Console

1. Go to the VM compute metadata page by visiting https://console.cloud.google.com/compute/metadata.
2. Ensure that key `enable-oslogin` is present with value set to `TRUE`.
3. Because instances can override project settings, ensure that no instance has custom metadata with key `enable-oslogin` and value `FALSE`.

### From Google Cloud CLI

1. List the instances in your project and get details on each instance:

```
gcloud compute instances list --format=json
```

2. Verify that the section `commonInstanceMetadata` has a key `enable-oslogin` set to value `TRUE`.

## Exception

VMs created by GKE should be excluded. These VMs have names that start with `gke-` and are labeled `goog-gke-node`.

## Remediation

### From Google Cloud Console

1. Go to the VM compute metadata page by visiting: https://console.cloud.google.com/compute/metadata.
2. Click `Edit`.
3. Add a metadata entry where the key is `enable-oslogin` and the value is `TRUE`.
4. Click `Save` to apply the changes.
5. For every instance that overrides the project setting, go to the `VM Instances` page at https://console.cloud.google.com/compute/instances.
6. Click the name of the instance on which you want to remove the metadata value.
7. At the top of the instance details page, click `Edit` to edit the instance settings.
8. Under `Custom metadata`, remove any entry with key `enable-oslogin` and the value is `FALSE`.
9. At the bottom of the instance details page, click `Save` to apply your changes to the instance.

### From Google Cloud CLI

1. Configure oslogin on the project:

```
gcloud compute project-info add-metadata --metadata enable-oslogin=TRUE
```

2. Remove instance metadata that overrides the project setting:

```
gcloud compute instances remove-metadata <INSTANCE_NAME> --keys=enable-oslogin
```

Optionally, you can enable two factor authentication for OS login. For more information, see: https://cloud.google.com/compute/docs/oslogin/setup-two-factor-authentication.

## Default Value

By default, parameter `enable-oslogin` is not set, which is equivalent to setting it to `FALSE`.

## References

1. https://cloud.google.com/compute/docs/instances/managing-instance-access
2. https://cloud.google.com/compute/docs/instances/managing-instance-access#enable_oslogin
3. https://cloud.google.com/sdk/gcloud/reference/compute/instances/remove-metadata
4. https://cloud.google.com/compute/docs/oslogin/setup-two-factor-authentication

## Additional Information

1. In order to use osLogin, instance using Custom Images must have the latest version of the Linux Guest Environment installed. The following image families do not yet support OS Login:

```
Project cos-cloud (Container-Optimized OS) image family cos-stable.

All project coreos-cloud (CoreOS) image families

Project suse-cloud (SLES) image family sles-11

All Windows Server and SQL Server image families
```

2. Project enable-oslogin can be over-ridden by setting enable-oslogin parameter to an instance metadata individually.

## CIS Controls

| Controls Version | Control                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.6 Centralize Account Management                  |      | X    | X    |
| v8               | 6.7 Centralize Access Control                      |      | X    | X    |
| v7               | 16.2 Configure Centralized Point of Authentication |      | X    | X    |
