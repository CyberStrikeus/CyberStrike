---
name: cis-apache24-3.13
description: "Ensure Access to Special Purpose Application Writable Directories is Properly Restricted"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.13"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.13 Ensure Access to Special Purpose Application Writable Directories is Properly Restricted

## Profile Applicability

- Level 1

## Description

When the Apache webserver includes application software such as PHP, Java and many others, it is common for the application to require a writable directory. The writable directory may be needed for file uploads, application data, user session state information or many other purposes. It is important such directories have a single purpose, and have access properly secured to prevent a variety of possible exploits. The directory should be:

- Single Purpose Directory
- Outside the Configured Web DocumentRoot
- Owned by the root User or an Administrator Account
- Not writable by Other

## Rationale

The following provides the rationale for each requirement on the application writable directory:

- **Single Purpose Directory** - Each writable application directory should have a single purpose. For example, mixing file uploads in the same directory with session tracking information would be an obvious vulnerability, as users could create session information, to hijack a manufacturer authenticated sessions.
- **Outside the Configured Web DocumentRoot** - The directory should NOT be under the configured DocumentRoot directory as such directories are browsable by default, and might allow unintended web read access. With web read access an attacker could upload malicious content, and then references the content in a URL exploiting the trust that users have in the website.
- **Owned by the root User or an Administrator Account** – The directory should be owned by root or a designated administrator to prevent unintended changes to the permissions.
- **Not Writable by Other** - The write access can be provided through the group permissions to the configured Apache group rather than allow write access to Other / all users. The group write access should implement the least privileges necessary in order prevent unintended access to the directory. If the application requires more complex write access, such as to specific accounts or for multiple groups, usage of an access control lists (ACL) is recommended. ACL's are supported by most Linux file systems, and can be enabled when the file system is mounted.

## Audit

Perform the following to determine if the recommended state is implemented:

1. **Single Purpose Directory** - For each application writable directory review the documented purpose for the directory to confirm the directory serves a single purpose.
2. **Outside the Configured Web DocumentRoot** - For each writable directory and it's corresponding DocumentRoot perform the following. No output from the find command indicates the directory is not within the DocumentRoot.
3. `# Set the WR_DIR to the writable directory such as the example shown below`
4. `WR_DIR=/var/phptmp/sessions`
5. `# DOCROOT is the DocumentRoot directory for the web site or virtual host.`
6. `DOCROOT=$(grep -i '^DocumentRoot' $APACHE_PREFIX/conf/httpd.conf | cut -d' ' -f2)`
7. `tr -d '\"')`
8. `# Get Inode number of the writable Directory`
9. `INUM=$(stat -c '%i' $WR_DIR)`
10. `# Verify the directory is not found (No output = Not found)`
11. `find -L $DOCROOT -inum $INUM`
12. **Owned by the root User or an Administrator Account** - For each writable directory, use the stat command to show the owner of each directory.
13. `stat -c '%U' $WR_DIR/`
14. **Not writable by Other** - For each writable directory, use the find command to identify directories writable by Other. No output indicates the directory and any sub-directories are not writable by Other.
15. `find $WR_DIR/ -perm /o=w -ls`

## Remediation

Perform the following:

1. **Single Purpose Directory** – Create separate directories of the multipurpose directory, and adjust the application configuration and directory ownership and permissions appropriately.
2. **Outside the Configured Web DocumentRoot** – Move the writable directory to a more suitable location NOT under the DocumentRoot directory. A location within the `/var/` filesystem may be a good choice for changeable data.
3. **Owned by the root User or an Administrator Account** – Change the ownership to root or an administrator.
4. `chown root $WR_DIR`
5. **Not writable by Other** – Remove the other write permissions, use group write or ACLs to provide the least privileges necessary.
6. `chmod o-w $WR_DIR`

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |

## Profile

- Level 1 | Manual
