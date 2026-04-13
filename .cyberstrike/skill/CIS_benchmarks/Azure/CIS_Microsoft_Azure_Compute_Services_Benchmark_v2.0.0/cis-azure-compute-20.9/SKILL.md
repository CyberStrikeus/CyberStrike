---
name: cis-azure-compute-20.9
description: "Ensure only MFA enabled identities can access privileged Virtual Machine"
category: cis-azure-compute
version: "2.0.0"
author: cyberstrike-official
tags: [cis, azure, virtual-machines, vm, disks, encryption]
cis_id: "20.9"
cis_benchmark: "CIS Microsoft Azure Compute Services Benchmark v2.0.0"
tech_stack: [azure]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure only MFA enabled identities can access privileged Virtual Machine

## Description

Verify identities without MFA that can log in to a privileged virtual machine using separate login credentials. An adversary can leverage the access to move laterally and perform actions with the virtual machine's managed identity. Make sure the virtual machine only has necessary permissions, and revoke the admin-level permissions according to the least privileges principal.

## Rationale

Integrating multi-factor authentication (MFA) as part of the organizational policy can greatly reduce the risk of an identity gaining control of valid credentials that may be used for additional tactics such as initial access, lateral movement, and collecting information. MFA can also be used to restrict access to cloud resources and APIs.

An Adversary may log into accessible cloud services within a compromised environment using Valid Accounts that are synchronized to move laterally and perform actions with the virtual machine's managed identity. The adversary may then perform management actions or access cloud-hosted resources as the logged-on managed identity.

## Impact

This recommendation requires the Entra ID P2 license to implement.

Ensure that identities that are provisioned to a virtual machine utilizes an RBAC/ABAC group and is allocated a role using Azure PIM, and the Role settings require MFA or use another third-party PAM solution for accessing Virtual Machines.

## Audit Procedure

### Using Azure Portal

1. Log in to the Azure portal.
2. Select the `Subscription`, then click on `Access control (IAM)`.
3. Click `Role : All` and click `All` to display the drop-down menu.
4. Type `Virtual Machine Administrator Login` and select `Virtual Machine Administrator Login`.
5. Review the list of identities that have been assigned the `Virtual Machine Administrator Login` role.
6. Go to `Microsoft Entra ID`.
7. For `Per-user MFA`:
   1. Under `Manage`, click `Users`.
   2. Click `Per-user MFA`.
   3. Ensure that none of the identities assigned the `Virtual Machine Administrator Login` role from step 4 have `Status` set to `disabled`.
8. For `Conditional Access`:
   1. Under `Manage`, click `Security`.
   2. Under `Protect`, click `Conditional Access`.
   3. Ensure that none of the identities assigned the `Virtual Machine Administrator Login` role from step 4 are exempt from a Conditional Access policy requiring MFA for all users.

## Expected Result

All identities with the `Virtual Machine Administrator Login` role should have MFA enabled, either through Per-user MFA or Conditional Access policies.

## Remediation

### Using Azure Portal

1. Log in to the Azure portal.
2. This can be remediated by enabling MFA for user, Removing user access or Reducing access of managed identities attached to virtual machines.

- **Case I**: Enable MFA for users having access on virtual machines.
  1. Go to `Microsoft Entra ID`.
  2. For `Per-user MFA`:
     1. Under `Manage`, click `Users`.
     2. Click `Per-user MFA`.
     3. For each user requiring remediation, check the box next to their name.
     4. Click `Enable MFA`.
     5. Click `Enable`.
  3. For `Conditional Access`:
     1. Under `Manage`, click `Security`.
     2. Under `Protect`, click `Conditional Access`.
     3. Update the Conditional Access policy requiring MFA for all users, removing each user requiring remediation from the `Exclude` list.

- **Case II**: Removing user access on a virtual machine.
  1. Select the `Subscription`, then click on `Access control (IAM)`.
  2. Select `Role assignments` and search for `Virtual Machine Administrator Login` or `Virtual Machine User Login` or any role that provides access to log into virtual machines.
  3. Click on `Role Name`, Select `Assignments`, and remove identities with no MFA configured.

- **Case III**: Reducing access of managed identities attached to virtual machines.
  1. Select the `Subscription`, then click on `Access control (IAM)`.
  2. Select `Role Assignments` from the top menu and apply filters on `Assignment type` as `Privileged administrator roles` and `Type` as `Virtual Machines`.
  3. Click on `Role Name`, Select `Assignments`, and remove identities access make sure this follows the least privileges principal.

## Default Value

By default, MFA is not enforced for Virtual Machine access.

## References

No specific references listed in the benchmark for this control.

## Profile

Level 2 | Manual
