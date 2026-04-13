---
name: cis-gcp-foundations-4.8
description: "Ensure Compute Instances Are Launched With Shielded VM Enabled"
category: cis-gcp-foundations
version: "4.0.0"
author: cyberstrike-official
tags: [cis, gcp, compute, virtual-machines, shielded-vm]
cis_id: "4.8"
cis_benchmark: "CIS Google Cloud Platform Foundation Benchmark v4.0.0"
tech_stack: [gcp]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.8 Ensure Compute Instances Are Launched With Shielded VM Enabled (Automated)

## Profile Applicability

- Level 2

## Description

To defend against advanced threats and ensure that the boot loader and firmware on your VMs are signed and untampered, it is recommended that Compute instances are launched with Shielded VM enabled.

## Rationale

Shielded VMs are virtual machines (VMs) on Google Cloud Platform hardened by a set of security controls that help defend against rootkits and bootkits.

Shielded VM offers verifiable integrity of your Compute Engine VM instances, so you can be confident your instances haven't been compromised by boot- or kernel-level malware or rootkits. Shielded VM's verifiable integrity is achieved through the use of Secure Boot, virtual trusted platform module (vTPM)-enabled Measured Boot, and integrity monitoring.

Shielded VM instances run firmware which is signed and verified using Google's Certificate Authority, ensuring that the instance's firmware is unmodified and establishing the root of trust for Secure Boot.

Integrity monitoring helps you understand and make decisions about the state of your VM instances and the Shielded VM vTPM enables Measured Boot by performing the measurements needed to create a known good boot baseline, called the integrity policy baseline. The integrity policy baseline is used for comparison with measurements from subsequent VM boots to determine if anything has changed.

Secure Boot helps ensure that the system only runs authentic software by verifying the digital signature of all boot components, and halting the boot process if signature verification fails.

## Audit

### From Google Cloud Console

1. Go to the `VM instances` page by visiting: https://console.cloud.google.com/compute/instances.
2. Click on the instance name to see its `VM instance details` page.
3. Under the section `Shielded VM`, ensure that `vTPM` and `Integrity Monitoring` are `on`.

### From Google Cloud CLI

1. For each instance in your project, get its metadata:

```
gcloud compute instances list --format=json | jq -r '. | "vTPM: \(.[].shieldedInstanceConfig.enableVtpm) IntegrityMonitoring: \(.[].shieldedInstanceConfig.enableIntegrityMonitoring) Name: \(.[].name)"'
```

2. Ensure that there is a `shieldedInstanceConfig` configuration and that configuration has the `enableIntegrityMonitoring` and `enableVtpm` set to `true`. If the VM is not a Shield VM image, you will not see a `shieldedInstanceConfig` in the output.

## Remediation

To be able turn on `Shielded VM` on an instance, your instance must use an image with Shielded VM support.

### From Google Cloud Console

1. Go to the `VM instances` page by visiting: https://console.cloud.google.com/compute/instances.
2. Click on the instance name to see its `VM instance details` page.
3. Click `STOP` to stop the instance.
4. When the instance has stopped, click `EDIT`.
5. In the Shielded VM section, select `Turn on vTPM` and `Turn on Integrity Monitoring`.
6. Optionally, if you do not use any custom or unsigned drivers on the instance, also select `Turn on Secure Boot`.
7. Click the `Save` button to modify the instance and then click `START` to restart it.

### From Google Cloud CLI

You can only enable Shielded VM options on instances that have Shielded VM support. For a list of Shielded VM public images, run the gcloud compute images list command with the following flags:

```
gcloud compute images list --project gce-uefi-images --no-standard-images
```

1. Stop the instance:

```
gcloud compute instances stop <INSTANCE_NAME>
```

2. Update the instance:

```
gcloud compute instances update <INSTANCE_NAME> --shielded-vtpm --shielded-vm-integrity-monitoring
```

3. Optionally, if you do not use any custom or unsigned drivers on the instance, also turn on secure boot:

```
gcloud compute instances update <INSTANCE_NAME> --shielded-vm-secure-boot
```

4. Restart the instance:

```
gcloud compute instances start <INSTANCE_NAME>
```

## Prevention

You can ensure that all new VMs will be created with Shielded VM enabled by setting up an Organization Policy to for `Shielded VM` at https://console.cloud.google.com/iam-admin/orgpolicies/compute-requireShieldedVm. Learn more at: https://cloud.google.com/security/shielded-cloud/shielded-vm#organization-policy-constraint.

## Default Value

By default, Compute Instances do not have Shielded VM enabled.

## References

1. https://cloud.google.com/compute/docs/instances/modifying-shielded-vm
2. https://cloud.google.com/shielded-vm
3. https://cloud.google.com/security/shielded-cloud/shielded-vm#organization-policy-constraint

## Additional Information

If you do use custom or unsigned drivers on the instance, enabling Secure Boot will cause the machine to no longer boot. Turn on Secure Boot only on instances that have been verified to not have any custom drivers installed.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 0.0 Explicitly Not Mapped | | | |
| v7 | 5.2 Maintain Secure Images | | X | X |
