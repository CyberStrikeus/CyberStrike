---
name: cis-apache-11.2
description: "Ensure Apache Processes Run in the httpd_t Confined Context"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, selinux, mandatory-access-control, mac]
cis_id: "11.2"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Apache Processes Run in the httpd_t Confined Context

## Description

SELinux includes customizable targeted policies that may be used to confine the Apache httpd server to enforce least privileges so the httpd server has only the minimal access to specified directories, files, and network ports. Access is controlled by process types (domains) defined for the httpd process. There are over a hundred individual httpd related types defined in a default Apache SELinux policy, which includes many of the common Apache add-ons and applications such as php, nagios, and smokeping. The default SELinux policies work well for a default Apache installation, but implementation of SELinux targeted policies on a complex or highly customized web server requires a rather significant development and testing effort which comprehends both the workings of SELinux and the detailed operations and requirements of the web application.

All directories and files to be accessed by the web server process must have security labels with appropriate types. The following types are a sample of the most commonly used:

- `http_port_t` - Network ports allowed for listening
- `httpd_sys_content_t` - Read access to directories and files with web content
- `httpd_log_t` - Directories and files to be used for writable log data
- `httpd_sys_script_exec_t` - Directories and files for executable content.

## Rationale

With the proper implementation of SELinux, vulnerabilities in the web application may be prevented from being exploited due to the additional restrictions. For example, a vulnerability that allows an attacker to read inappropriate system files may be prevented from execution by SELinux because the inappropriate files are not labeled as `httpd_sys_content_t`. Likewise, writing to an unexpected directory or execution of unexpected content can be prevented by similar mandatory security labels enforced by SELinux.

## Impact

None documented

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

Check that all of the Apache httpd processes are confined to the `httpd_t` SELinux context. The type (the third colon separated field) for each process should be `httpd_t`. Note that on some platforms, such as Ubuntu, the Apache executable is named apache2 instead of httpd.

```bash
$ ps -eZ | grep httpd
unconfined_u:system_r:httpd_t:s0 1366 ? 00:00:00 httpd
unconfined_u:system_r:httpd_t:s0 1368 ? 00:00:00 httpd
. . .
```

## Remediation

Perform the following to implement the recommended state:

If the running httpd processes are not confined to the `httpd_t` SELinux context, check the context for the httpd binary and the `apachectl` binary, and set the httpd binary to have a context of `httpd_exec_t` and the `apachectl` executable to have a context of `initrc_exec_t`, as shown below. Also note that on some platforms, such as Ubuntu, the Apache executable is named apache2 instead of httpd.

```bash
# ls -alZ /usr/sbin/httpd /usr/sbin/httpd.* /usr/sbin/apachectl
-rwxr-xr-x. root root system_u:object_r:initrc_exec_t:s0 /usr/sbin/apachectl
-rwxr-xr-x. root root system_u:object_r:httpd_exec_t:s0 /usr/sbin/httpd
-rwxr-xr-x. root root system_u:object_r:httpd_exec_t:s0
/usr/sbin/httpd.worker
-rwxr-xr-x. root root system_u:object_r:httpd_exec_t:s0 /usr/sbin/httpd.event
```

If the executable files are not labeled correctly, they may be relabeled with the `chcon` command, as shown; however, the file system labeling is based on the SELinux file context policies, and the file systems will on some occasions be relabeled according to the policy.

```bash
# chcon -t initrc_exec_t /usr/sbin/apachectl
# chcon -t httpd_exec_t /usr/sbin/httpd /usr/sbin/httpd.*
```

Since the file system may be relabeled based on SELinux policy, it's best to check the SELinux policy with the `semanage fcontext -l` option. If the policy is not present, add the pattern to the policy using the `-a` option. The `restorecon` command shown below will restore the file context label according to the current policy, and is required if a pattern was added.

```bash
# ### Check the Policy
# semanage fcontext -l | fgrep 'apachectl'
/usr/sbin/apachectl1 regular file system_u:object_r:initrc_exec_t:s0
# semanage fcontext -l | fgrep '/usr/sbin/httpd'
/usr/sbin/httpd regular file system_u:object_r:httpd_exec_t:s0
/usr/sbin/httpd.worker regular file system_u:object_r:httpd_exec_t:s0
/usr/sbin/httpd.event regular file system_u:object_r:httpd_exec_t:s0
# ### Add to the policy, if not present
# semanage fcontext -f -- -a -t httpd_exec_t '/usr/sbin/httpd'
# semanage fcontext -f -- -a -t httpd_exec_t '/usr/sbin/httpd.worker'
# semanage fcontext -f -- -a -t httpd_exec_t '/usr/sbin/httpd.event'
# semanage fcontext -f -- -a -t initrc_exec_t /usr/sbin/apachectl
# ### Restore the file labeling accord to the SELinux policy
# restorecon -v /usr/sbin/httpd /usr/sbin/httpd.* /usr/sbin/apachectl
```

## Default Value

SELinux is not enabled by default.

## References

1. https://access.redhat.com/documentation/en-US/Red_Hat_Enterprise_Linux/6/html/Security-Enhanced_Linux/chap-Security-Enhanced_Linux-Targeted_Policy.html

## CIS Controls

Version 6

14.4 Protect Information With Access Control Lists
All information stored on systems shall be protected with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

Version 7

14.6 Protect Information through Access Control Lists
Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile

Level 2 | Scored
