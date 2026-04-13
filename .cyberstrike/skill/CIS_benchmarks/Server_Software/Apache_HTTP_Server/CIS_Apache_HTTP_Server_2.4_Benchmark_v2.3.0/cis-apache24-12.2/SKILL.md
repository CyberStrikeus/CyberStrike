---
name: cis-apache24-12.2
description: "Ensure the Apache AppArmor Profile Is Configured Properly (Manual)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, apparmor, mac, profile-configuration]
cis_id: "12.2"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Apache AppArmor Profile Is Configured Properly (Manual)

## Profile Applicability
- Level 2

## Description

AppArmor includes customizable profiles that may be used to confine the Apache web server to enforce least privileges so that the server has only the minimal access to specified directories, files and network ports. Access is controlled by a profile defined for the apache2 process. The default AppArmor profile is typically a very permissive profile that allows read-write access to all system files. Therefore, it's important that the default profile be customized to enforce least privileges. The AppArmor utilities such as `aa-autodep`, `aa-complain`, and `aa-logprof` can be used to generate an initial profile based on actual usage. However thorough testing, review and customization will be necessary to ensure that the Apache profile restrictions allow necessary functionality while implementing least privilege.

## Rationale

With the proper implementation of AppArmor profile, vulnerabilities in the web application may be prevented from being exploited due to the additional restrictions. For example, a vulnerability that allows an attacker to read an inappropriate system files may be prevented from execution by AppArmor because the inappropriate files are not allowed by the profile. Likewise writing to an unexpected directory or execution of unexpected content can be prevented by similar mandatory security controls enforced by AppArmor.

## Audit

Perform the following steps to determine if the recommended state is implemented:

1. Find the Apache AppArmor profile typically found in `/etc/apparmor.d/usr.sbin.apache2` along with any files included by the profile such as `/etc/apparmor.d/apache2.d/*` and files in the `/etc/apparmor.d/abstractions/` directory.

2. Review the capabilities and permissions granted to ensure that the profile implements least privileges for the web application. Wild-card paths such as `/**`, which grant access to all files and directories starting with the root level directory, should not be present in the profile. Instead read only access to specific necessary system files such as `/etc/group` and to the web content files such as `/var/www/html/**` should be given. Refer to the `apparmor.d` man page for additional details. Shown below are some possible example capabilities and path permissions.
   - `capability dac_override,`
   - `capability dac_read_search,`
   - `capability net_bind_service,`
   - `capability setgid,`
   - `capability setuid,`
   - `capability kill,`
   - `capability sys_tty_config,`
   - `. . .`
   - `/usr/sbin/apache2 mr,`
   - `/etc/gai.conf r,`
   - `/etc/group r,`
   - `/etc/apache2/** r,`
   - `/var/www/html/** r,`
   - `/run/apache2/** rw,`
   - `/run/lock/apache2/** rw,`
   - `/var/log/apache2/** rw,`
   - `/etc/mime.types r,`

## Remediation

Perform the following to implement the recommended state:

1. Stop the Apache server
   - `# service apache2 stop`

3. Create a mostly empty apache2 profile based on program dependencies.
   - `# aa-autodep apache2`
   - `Writing updated profile for /usr/sbin/apache2.`

6. Set the apache2 profile in complain mode so that access violations will be allowed and logged.
   - `# aa-complain apache2`
   - `Setting /usr/sbin/apache2 to complain mode.`

9. Start the apache2 service
   - `# service apache2 start`

11. Thoroughly test the web application attempting to exercise all intended functionality so that AppArmor will generate the necessary logs of all resources accessed. The logs are sent via the system syslog utility and are typically found in either the `/var/log/syslog` or `/var/log/messages` files. Also stop and restart the web server as part of the httpd process.

12. Use `aa-logprof` to update the profile based on logs generated during the testing. The tool will prompt for suggested modifications to the profile, based on the logs. The logs may also be reviewed manually in order to update the profile.
    - `# aa-logprof`

14. Review and edit the profile, removing any inappropriate content, and adding appropriate access rules. Directories with multiple files accessed with the same permission can be simplified with the usage of wild-cards when appropriate. Reload the updated profile using the `apparmor_parser` command.
    - `# apparmor_parser -r /etc/apparmor.d/usr.sbin.apache2`

16. Test the new updated profile again and check for any new AppArmor denied logs generated. Update and reload the profile as necessary. Repeat the application tests, until no new AppArmor deny logs are created, except for access which should be prohibited.
    - `# tail -f /var/log/syslog`

18. Set the apache2 profile to enforce mode, reload AppArmor, and then test the web site functionality again.
    - `# aa-enforce /usr/sbin/apache2`
    - `# /etc/init.d/apparmor reload`

## Default Value

The default Apache profile is very permissive.

## References

1. https://wiki.ubuntu.com/AppArmor

## CIS Controls

**v8:**
- 2.5 Allowlist Authorized Software
  - Use technical controls, such as application allowlisting, to ensure that only authorized software can execute or be accessed. Reassess bi-annually, or more frequently.

**v7:**
- 2.7 Utilize Application Whitelisting
  - Utilize application whitelisting technology on all assets to ensure that only authorized software executes and all unauthorized software is blocked from executing on assets.

## Profile
- Level 2
