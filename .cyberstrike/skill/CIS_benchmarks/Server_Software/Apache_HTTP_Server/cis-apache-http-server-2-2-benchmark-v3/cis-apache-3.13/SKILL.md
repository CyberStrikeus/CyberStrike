---
name: cis-apache-3.13
description: "Ensure Access to Special Purpose Application Writable Directories is Properly Restricted"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.13"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Access to Special Purpose Application Writable Directories is Properly Restricted

## Description

When the Apache webserver includes application software such as PHP, Java and many others, it is common for the application to require a writable directory. The writable directory may be needed for file uploads, application data, user session state information or many other purposes. It is important such directories have a single purpose, and have access properly secured to prevent a variety of possible exploits. The directory should be:

- Single Purpose Directory
- Outside the Configured Web DocumentRoot
- Owned by the root User or an Administrator Account
- Not writable by Other

## Rationale

The following provides the rationale for each requirement on the application writable directory:

- **Single Purpose Directory** - Each writable application directory should have a single purpose. For example, mixing file uploads in the same directory with session tracking information would be an obvious vulnerability, as users could create session information, to hijack or manufacturer authenticated sessions.

- **Outside the Configured Web DocumentRoot** - The directory should NOT be under the configured DocumentRoot directory as such directories are browsable by default, and might allow unintentional web read access. With web read access an attacker could upload malicious content, and then references the content in a URL exploiting the trust that users have in the website.

- **Owned by the root User or an Administrator Account** - The directory should be owned by root or a designated administrator to prevent unintended changes to the permissions.

- **Not Writable by Other** - The write access can be provided through the group permissions to the configured Apache group rather than allow write access to Other / all users. The group write access should implement the least privileges necessary in order to prevent unintended access to the directory. If the application requires more complex write access, such as to specific accounts or for multiple groups, usage of an access control lists (ACL) is recommended. ACL's are supported by most Linux file systems, and can be enabled when the file system is mounted.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the recommended state is implemented:

1. **Single Purpose Directory** - For each application writable directory review the documented purpose for the directory to confirm the directory serves a single purpose.

2. **Outside the Configured Web DocumentRoot** - For each writable directory and it's corresponding DocumentRoot setting verify the following. No output from the find command indicates the directory is not within the DocumentRoot.

```
# Set the WR_DIR to the writable directory such as the example shown below
WR_DIR=/var/phptmp/sessions
# DOCROOT is the DocmentRoot directory for the web site or virtual host.
DOCROOT=$(grep -i '^DocumentRoot' $APACHE_PREFIX/conf/httpd.conf | cut -d' ' -f2)
    tr -d \"''\")
# Get Inode number of the writable Directory
INUM=$(stat -c '%i' $WR_DIR)
# Verify the directory is not found (No output = Not found)
find -L $DOCROOT -inum $INUM
```

3. **Owned by the root User or an Administrator Account** - For each writable directory, use the stat command to show the owner of each directory.

```
stat -c '%U' $WR_DIR/
```

4. **Not writable by Other** - For each writable directory, use the find command to identify directories writable by Other. No output indicates the directory and any sub-directories are not writable by Other.

```
find $WR_DIR/ -perm /o=w -ls
```

## Remediation

Perform the following:

1. **Single Purpose Directory** – Create separate directories of the multipurpose directory, and adjust the application configuration and directory ownership and permissions appropriately.

2. **Outside the Configured Web DocumentRoot** – Move the writable directory to a more suitable location NOT under the DocumentRoot directory. A location within the `/var/` filesystem may be a good choice for changeable data.
3. **Owned by the root User or an Administrator Account** - Change the ownership and group of the directory to be `root:root`.
4. **Change the permissions for the directory** so it is only writable by root, or the user under which apache initially starts up (default is root).

## Default Value

None documented

## References

None documented

## CIS Controls

### Version 6

14.4 Protect Information With Access Control Lists

All information stored on systems shall be protected with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

### Version 7

14.6 Protect Information through Access Control Lists

Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile

Level 1 | Not Scored
