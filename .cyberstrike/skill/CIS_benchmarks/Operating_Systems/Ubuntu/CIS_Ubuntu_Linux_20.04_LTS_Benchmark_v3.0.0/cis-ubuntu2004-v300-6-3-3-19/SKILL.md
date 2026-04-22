---
name: cis-ubuntu2004-v300-6-3-3-19
version: "3.0.0"
tags:
  - cis
  - ubuntu
  - linux
  - ubuntu-20.04
  - auditing
  - auditd
category: cis-logging
severity_boost: {}
---

# CIS Ubuntu 20.04 LTS Benchmark v3.0.0 - 6.3.3.19

**Control:** Ensure kernel module loading unloading and modification is collected

**Profile Applicability:** Level 2 - Server, Level 2 - Workstation

**Description:**
Monitor the loading and unloading of kernel modules. All the loading / listing / dependency checking of modules is done by kmod via symbolic links.

The following system calls control loading and unloading of modules:
- init_module - load a module
- finit_module - load a module (used when the overhead of using cryptographically signed modules to determine the authenticity of a module can be avoided)
- delete_module - delete a module
- create_module - create a loadable module entry
- query_module - query the kernel for various bits pertaining to modules

Any execution of the loading and unloading module programs and system calls will trigger an audit record with an identifier of modules.

**Rationale:**
Monitoring the use of all the various ways to manipulate kernel modules could provide system administrators with evidence that an unauthorized change was made to a kernel module, possibly compromising the security of the system.

## Audit

### On disk configuration
Run the following script to check the on disk rules:

```bash
#!/usr/bin/env bash
{
  awk '/^ *-a *always,exit/ \
    &&/ -F *arch=b64/ \
    &&(/ -F auid!=unset/||/ -F auid!=-1/||/ -F auid!=4294967295/) \
    &&/ -S/ \
    &&/init_module/ \
    &&(/init_module/ \
      ||/delete_module/ \
      ||/create_module/ \
      ||/query_module/) \
    &&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)' /etc/audit/rules.d/*.rules

  UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
  [ -n "${UID_MIN}" ] || UID_MIN=1000
  awk "/^ *-a *always,exit/ \
    &&/ -F *auid!=unset/||/ -F *auid!=-1/||/ -F *auid!=4294967295/) \
    &&/ -F *auid>=${UID_MIN}/ \
    &&/ -F *perm=x/ \
    &&/ -F *path=\/usr\/bin\/kmod/ \
    &&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)" /etc/audit/rules.d/*.rules \
  || printf "ERROR: Variable 'UID_MIN' is unset.\n"
}
```

Verify the output matches:
```
-a always,exit -F arch=b64 -S init_module,finit_module,delete_module,create_module,query_module -F auid>=1000 -F auid!=unset -k kernel_modules
-a always,exit -F path=/usr/bin/kmod -F perm=x -F auid>=1000 -F auid!=unset -k kernel_modules
```

### Running configuration
Run the following script to check loaded rules:

```bash
#!/usr/bin/env bash
{
  auditctl -l | awk '/^ *-a *always,exit/ \
    &&/ -F *arch=b64/ \
    &&(/ -F auid!=unset/||/ -F auid!=-1/||/ -F auid!=4294967295/) \
    &&/ -S/ \
    &&/init_module/ \
    &&(/init_module/ \
      ||/finit_module/ \
      ||/delete_module/ \
      ||/create_module/ \
      ||/query_module/) \
    &&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)'

  UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
  [ -n "${UID_MIN}" ] || auditctl -l | awk "/^ *-a *always,exit/ \
    &&(/ -F *auid!=unset/||/ -F *auid!=-1/||/ -F *auid!=4294967295/) \
    &&/ -F *auid>=${UID_MIN}/ \
    &&/ -F *perm=x/ \
    &&/ -F *path=\/usr\/bin\/kmod/ \
    &&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)" \
  || printf "ERROR: Variable 'UID_MIN' is unset.\n"
}
```

Verify the output includes:
```
-a always,exit -F arch=b64 -S create_module,init_module,delete_module,query_module,finit_module -F auid>=1000 -F auid!=-1 -F key=kernel_modules
-a always,exit -S all -F path=/usr/bin/kmod -F perm=x -F auid>=1000 -F auid!=-1 -F key=kernel_modules
```

### Symlink audit
Run the following script to audit if the kmod symlinks accepts are indeed pointing at it:

```bash
#!/usr/bin/env bash
{
  a_files=("/usr/sbin/lsmod" "/usr/sbin/rmmod" "/usr/sbin/insmod" "/usr/sbin/modinfo" "/usr/sbin/modprobe" "/usr/sbin/depmod")
  for i_file in "${a_files[@]}"; do
    if [ "$(readlink -f "$i_file")" = "$(readlink -f /bin/kmod)" ]; then
      printf "OK: \"${i_file}\"\n"
    else
      printf "Issue with symlink for file: \"${i_file}\"\n"
    fi
  done
}
```

Verify the output states OK. If there is a symlink pointing to a different location it should be investigated.

## Remediation

Create audit rules by editing or creating a file in the `/etc/audit/rules.d/` directory, ending in `.rules` extension, with the relevant rules to monitor kernel module modification.

Example:
```bash
#!/usr/bin/env bash
{
  UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
  [ -n "${UID_MIN}" ] && printf "
-a always,exit -F arch=b64 -S init_module,finit_module,delete_module,create_module,query_module -F auid>=${UID_MIN} -F auid!=unset -k kernel_modules
-a always,exit -F path=/usr/bin/kmod -F perm=x -F auid>=${UID_MIN} -F auid!=unset -k kernel_modules
" >> /etc/audit/rules.d/50-kernel_modules.rules || printf "ERROR: Variable 'UID_MIN' is unset.\n"
}
```

Load audit rules:
```bash
augenrules --load
```

Check if reboot is required:
```bash
if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then printf "Reboot required to load rules\n"; fi
```

**Additional Information:**

Potential reboot required - If the auditing configuration is locked (-e 2), then augenrules will not warn in any way that rules could not be loaded into the running configuration. A system reboot will be required to load the rules into the running configuration.

System call structure - For performance (man 7 audit.rules) reasons it is preferable to have all the system calls on one line. However, your configuration may have them on one line each or some other combination. This is important to understand for both the auditing and remediation sections as the examples given are optimized for performance as per the man page.

**CIS Controls:**
- v8: 8.5 Collect Detailed Audit Logs - Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation.
- v7: 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices.

**MITRE ATT&CK Mappings:**
- Techniques: T1562, T1562.006
- Tactics: TA0004
- Mitigations: M1047

**References:**
- NIST SP 800-53 Rev. 5: AU-3, CM-6
- STIG ID: UBTU-20-010296 | RULE ID: SV-238318r991586 | CAT II
- STIG ID: UBTU-22-654060 | RULE ID: SV-260614r991586 | CAT II
