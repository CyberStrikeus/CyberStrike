import z from "zod"
import { Tool } from "../tool"
import {
  setStealthState,
  setExecMethod,
  argVal,
  hasFlag,
  detectEnv,
  resolveExec,
  activeExec,
  resetEnvCache,
} from "./shared"
import type { Finding, HookResult, StealthMode, ExecMethod } from "./shared"

import {
  systemInfo,
  processEnum,
  networkEnum,
  userEnum,
  serviceEnum,
  packageEnum,
  containerDetect,
  securityFramework,
  interestingFiles,
  mountEnum,
  kernelModuleEnum,
  localReconLinux,
} from "./recon"
import {
  shadowDump,
  sshKeyHarvest,
  bashHistorySecrets,
  gnomeKeyringDump,
  kwalletDump,
  browserCredsLinux,
  envSecrets,
  procMemoryHarvest,
  gpgKeyExtract,
  cloudCredHarvest,
  dockerConfigCreds,
  gitCredHarvest,
  wifiCredsNm,
  kerberosKeytab,
  dbCredHarvest,
  vncPassword,
  mailSpoolHarvest,
  netrcHarvest,
  ldapCredHarvest,
  credentialFilesScan,
} from "./credential"
import {
  sudoMisconfig,
  suidSgidScan,
  capabilitiesAbuse,
  cronPrivesc,
  nfsNoRootSquash,
  pathHijack,
  ldPreloadAbuse,
  kernelExploitCheck,
  writablePasswd,
  pkexecCve,
  systemdUnitAbuse,
  dbusExploit,
  pipSetupAbuse,
  sharedLibHijack,
  logrotateRace,
  writableServiceBin,
  polkitBypass,
  snapPrivesc,
  dockerGroupEscape,
  lxdGroupEscape,
  pythonLibHijack,
  motdAbuse,
  wildcardInjection,
  mysqlUdf,
  ptraceScopeCheck,
} from "./privesc"
import {
  cronPersist,
  systemdPersist,
  bashrcPersist,
  sshAuthorizedKeys,
  ldSoPreload,
  sysvinitPersist,
  atJobPersist,
  udevRulesPersist,
  pamBackdoor,
  motdPersist,
  xdgAutostart,
  gitHookPersist,
  kernelModulePersist,
  aptHookPersist,
  dpkgTriggerPersist,
  socketActivation,
  userServicePersist,
  xinetdPersist,
  rcLocalPersist,
  logrotatePersist,
  sshRcPersist,
  ldConfigPersist,
} from "./persistence"
import {
  sshPivot,
  ansibleAbuse,
  puppetAbuse,
  saltAbuse,
  nfsMountAttack,
  rsyncExploit,
  sshTunnel,
  socatTunnel,
  internalScan,
  proxychainsSetup,
} from "./lateral"
import {
  logTamper,
  historyClear,
  timestomp,
  auditdEvade,
  selinuxBypass,
  apparmorBypass,
  rootkitDetect,
  processHide,
  fileHide,
  networkHide,
  syslogManipulate,
  stealthCheckLinux,
} from "./evasion"
import {
  dataStage,
  dnsTunnelExfil,
  icmpExfil,
  covertChannel,
  httpsExfil,
  cleanupLinux,
  artifactEnum,
  steganographyExfil,
} from "./exfil"
import {
  arpSpoof,
  dnsSpoof,
  packetCapture,
  portScanNative,
  mitmProxy,
  responderLinux,
  firewallEnum,
  trafficRedirect,
  wifiAttack,
  ipv6Attack,
} from "./network"

const PROGRAMS = {
  detect_env: {
    description:
      "Detect Linux environment capabilities — shell, bash/python3/perl/busybox availability, root/sudo status, kernel version, distro, SELinux/AppArmor, container detection, init system, package manager, tool inventory. Returns recommended exec method. ALWAYS run first on a new target",
    args: "",
  },
  system_info: {
    description:
      "Gather comprehensive system information — hostname, kernel version, OS release, CPU, memory, uptime, logged-in users, environment variables, and installed security tools",
    args: "[--verbose]",
  },
  process_enum: {
    description:
      "Enumerate running processes with full details — PID, PPID, user, CPU/memory usage, command line, open files, network connections. Identifies security tools, monitoring agents, and interesting targets",
    args: "[--verbose] [--user USER]",
  },
  network_enum: {
    description:
      "Enumerate network configuration — interfaces, IP addresses, routes, DNS, ARP cache, listening ports, established connections, iptables rules, and network namespaces",
    args: "[--verbose]",
  },
  user_enum: {
    description:
      "Enumerate users and groups — /etc/passwd, /etc/group, sudo group members, logged-in users, SSH authorized keys, home directory permissions, shell history files, and .ssh directories",
    args: "[--verbose]",
  },
  service_enum: {
    description:
      "Enumerate system services — systemd units, init.d scripts, running daemons, enabled/disabled status, service configurations, and listening service ports",
    args: "[--verbose]",
  },
  package_enum: {
    description:
      "Enumerate installed packages — detect package manager, list all packages with versions, identify security-relevant packages, find outdated packages with known CVEs",
    args: "[--verbose] [--security-only]",
  },
  container_detect: {
    description:
      "Detect container/virtualization environment — Docker, LXC, Kubernetes, Podman, WSL, VM hypervisors. Check for container escape opportunities and host access",
    args: "",
  },
  security_framework: {
    description:
      "Enumerate security frameworks — SELinux mode/policy, AppArmor profiles/enforcement, seccomp filters, capabilities, audit system status, PAM configuration, and security modules",
    args: "[--verbose]",
  },
  interesting_files: {
    description:
      "Find security-relevant files — SUID/SGID binaries, world-writable files/directories, config files with credentials, backup files, database files, private keys, and core dumps",
    args: "[--deep] [--path PATH]",
  },
  mount_enum: {
    description:
      "Enumerate mount points and filesystems — mounted filesystems, fstab entries, NFS/CIFS shares, tmpfs/devtmpfs, mount options (nosuid, noexec), and unmounted partitions",
    args: "[--verbose]",
  },
  kernel_module_enum: {
    description:
      "Enumerate loaded kernel modules — list modules with descriptions, identify security modules, detect rootkit indicators, check module signing enforcement, and find loadable module paths",
    args: "[--verbose]",
  },
  local_recon_linux: {
    description:
      "Comprehensive local reconnaissance combining system info, users, network, services, and security frameworks into a single attack surface assessment",
    args: "[--verbose]",
  },
  shadow_dump: {
    description:
      "Extract /etc/shadow password hashes — read shadow file (requires root or shadow group), parse hash formats ($1$/$5$/$6$/$y$), identify weak/empty/locked accounts, suggest cracking approach",
    args: "",
  },
  ssh_key_harvest: {
    description:
      "Harvest SSH private keys from all users — scan home directories, /etc/ssh, and common key locations for id_rsa/id_ed25519/id_ecdsa files, check permissions, extract public key fingerprints",
    args: "[--user USER]",
  },
  bash_history_secrets: {
    description:
      "Extract secrets from shell history files — scan .bash_history, .zsh_history, .sh_history for passwords, tokens, API keys, database connection strings passed as command arguments",
    args: "[--user USER]",
  },
  gnome_keyring_dump: {
    description:
      "Extract credentials from GNOME Keyring — enumerate keyrings, dump stored passwords, WiFi credentials, application secrets. Requires user session or keyring unlock",
    args: "",
  },
  kwallet_dump: {
    description:
      "Extract credentials from KDE Wallet (KWallet) — enumerate wallets, dump stored passwords, network credentials, and application secrets",
    args: "",
  },
  browser_creds_linux: {
    description:
      "Extract browser credentials on Linux — Chrome/Chromium/Firefox saved passwords, cookies, history. Chrome uses GNOME Keyring/kwallet for encryption, Firefox uses NSS key4.db",
    args: "[--browser chrome|firefox|all]",
  },
  env_secrets: {
    description:
      "Extract secrets from environment variables — scan /proc/*/environ for API keys, tokens, passwords, database URLs, cloud credentials across all accessible processes",
    args: "",
  },
  proc_memory_harvest: {
    description:
      "Harvest credentials from process memory — scan /proc/PID/maps and mem for passwords, tokens, keys in running processes (requires ptrace or root). Targets sshd, sudo, su, gpg-agent",
    args: "[--pid PID] [--pattern REGEX]",
  },
  gpg_key_extract: {
    description:
      "Extract GPG/PGP private keys — enumerate keyrings, export secret keys, find passphrase-less keys, identify key trust relationships and encrypted files",
    args: "[--user USER]",
  },
  cloud_cred_harvest: {
    description:
      "Harvest cloud provider credentials — AWS (~/.aws/credentials, IAM role), GCP (~/.config/gcloud), Azure (~/.azure), DigitalOcean, Heroku, and cloud metadata endpoints",
    args: "",
  },
  docker_config_creds: {
    description:
      "Extract Docker registry credentials — ~/.docker/config.json auth tokens, registry passwords, and container environment secrets from docker inspect",
    args: "",
  },
  git_cred_harvest: {
    description:
      "Harvest Git credentials — .git-credentials, .gitconfig credential helpers, GitHub/GitLab tokens, SSH deploy keys, and repository secrets in .env files",
    args: "",
  },
  wifi_creds_nm: {
    description:
      "Extract WiFi credentials from NetworkManager — /etc/NetworkManager/system-connections/ WPA-PSK passwords, 802.1X credentials, VPN secrets (requires root)",
    args: "",
  },
  kerberos_keytab: {
    description:
      "Extract Kerberos credentials — keytab files (/etc/krb5.keytab, user keytabs), ccache tickets (/tmp/krb5cc_*), and krb5.conf realm configuration",
    args: "",
  },
  db_cred_harvest: {
    description:
      "Harvest database credentials — MySQL .my.cnf, PostgreSQL .pgpass, MongoDB config, Redis requirepass, and database connection strings in application configs",
    args: "",
  },
  vnc_password: {
    description:
      "Extract VNC passwords — decode ~/.vnc/passwd (DES-encrypted, trivially reversible), check x11vnc configs, and TigerVNC/TightVNC password files",
    args: "",
  },
  mail_spool_harvest: {
    description:
      "Harvest credentials from mail spools — scan /var/mail/*, /var/spool/mail/*, and user Maildir for password reset emails, credentials, tokens, and API keys",
    args: "[--user USER]",
  },
  netrc_harvest: {
    description:
      "Extract credentials from .netrc files — plaintext login/password entries for FTP, HTTP, and other services stored in ~/.netrc",
    args: "",
  },
  ldap_cred_harvest: {
    description:
      "Extract LDAP credentials — ldap.conf bind passwords, sssd.conf credentials, nslcd.conf, pam_ldap.conf, and phpLDAPadmin configs",
    args: "",
  },
  credential_files_scan: {
    description:
      "Comprehensive credential file scan — find files containing passwords, tokens, keys across the filesystem using pattern matching and entropy analysis",
    args: "[--path PATH] [--deep]",
  },
  sudo_misconfig: {
    description:
      "Analyze sudo configuration for privilege escalation — parse /etc/sudoers and sudoers.d, identify NOPASSWD entries, GTFOBins-exploitable commands, env_keep abuses, and wildcards",
    args: "",
  },
  suid_sgid_scan: {
    description:
      "Scan for SUID/SGID binaries — find all SUID/SGID executables, cross-reference with GTFOBins, identify custom/non-standard SUID binaries, check for known vulnerable versions",
    args: "[--path PATH]",
  },
  capabilities_abuse: {
    description:
      "Enumerate and exploit Linux capabilities — find binaries with dangerous capabilities (cap_setuid, cap_dac_override, cap_sys_admin, cap_net_raw), identify escalation paths",
    args: "",
  },
  cron_privesc: {
    description:
      "Analyze cron jobs for privilege escalation — world-writable cron scripts, writable cron directories, PATH hijack in cron environment, and wildcard injection in cron commands",
    args: "",
  },
  nfs_no_root_squash: {
    description:
      "Exploit NFS no_root_squash — enumerate NFS exports with root access allowed, mount share, create SUID binary for local privilege escalation",
    args: "[--target HOST]",
  },
  path_hijack: {
    description:
      "Exploit PATH-based privilege escalation — find services/scripts running as root with relative paths, writable PATH directories, and missing binary references",
    args: "",
  },
  ld_preload_abuse: {
    description:
      "Exploit LD_PRELOAD for privilege escalation — check sudo env_keep for LD_PRELOAD, SUID binaries without NOFOLLOW, and ld.so.preload write access",
    args: "",
  },
  kernel_exploit_check: {
    description:
      "Check kernel for known privilege escalation exploits — DirtyPipe (CVE-2022-0847), DirtyCow (CVE-2016-5195), Polkit (CVE-2021-4034), netfilter, OverlayFS, and others based on kernel version",
    args: "",
  },
  writable_passwd: {
    description:
      "Check if /etc/passwd or /etc/shadow is writable — add root user, modify existing entries, or replace password hashes for instant privilege escalation",
    args: "",
  },
  pkexec_cve: {
    description:
      "Check for PwnKit (CVE-2021-4034) — pkexec local privilege escalation via ARGV manipulation. Checks pkexec version and patch status",
    args: "",
  },
  systemd_unit_abuse: {
    description:
      "Exploit writable systemd units — find user-modifiable service/timer/socket files, writable ExecStart paths, and systemd configuration overrides for privilege escalation",
    args: "",
  },
  dbus_exploit: {
    description:
      "Exploit D-Bus for privilege escalation — enumerate D-Bus services, find services running as root with permissive policies, and known D-Bus CVEs",
    args: "",
  },
  pip_setup_abuse: {
    description:
      "Exploit pip/setup.py for code execution — check if pip install runs as root (sudo pip), writable site-packages, and setup.py command injection during package install",
    args: "",
  },
  shared_lib_hijack: {
    description:
      "Hijack shared libraries for privilege escalation — find SUID/root binaries with missing library dependencies (RPATH/RUNPATH abuse), writable library directories in search path",
    args: "",
  },
  logrotate_race: {
    description:
      "Exploit logrotate race condition (CVE-2016-1247) — check logrotate version and configuration for privilege escalation via log file symlink race",
    args: "",
  },
  writable_service_bin: {
    description:
      "Find writable service binaries — services running as root with world-writable or user-writable executable paths for privilege escalation",
    args: "",
  },
  polkit_bypass: {
    description:
      "Exploit Polkit/PolicyKit for privilege escalation — check for CVE-2021-3560 (timing attack), CVE-2021-4034 (PwnKit), and permissive Polkit rules",
    args: "",
  },
  snap_privesc: {
    description:
      "Exploit snap for privilege escalation — DirtySnap (CVE-2022-3328), snap confine vulnerabilities, and writable snap directories",
    args: "",
  },
  docker_group_escape: {
    description:
      "Exploit docker group membership for root — mount host filesystem via docker, run privileged container, access host namespaces. docker group = root equivalent",
    args: "",
  },
  lxd_group_escape: {
    description:
      "Exploit lxd/lxc group membership for root — import minimal image, mount host filesystem, gain root access via LXD container privilege escalation",
    args: "",
  },
  python_lib_hijack: {
    description:
      "Exploit Python library path for privilege escalation — writable sys.path entries, PYTHONPATH injection, .pth file abuse in site-packages",
    args: "",
  },
  motd_abuse: {
    description:
      "Exploit MOTD (Message of the Day) scripts for privilege escalation — writable /etc/update-motd.d/ scripts run as root on every login",
    args: "",
  },
  wildcard_injection: {
    description:
      "Exploit wildcard expansion in privileged scripts — tar, rsync, chown with wildcards in cron jobs or scripts allow arbitrary command execution via crafted filenames",
    args: "[--path PATH]",
  },
  mysql_udf: {
    description:
      "Exploit MySQL UDF for privilege escalation — create User Defined Function from shared library to execute system commands as mysql user (often root)",
    args: "[--socket PATH]",
  },
  ptrace_scope_check: {
    description:
      "Check ptrace scope restrictions — /proc/sys/kernel/yama/ptrace_scope setting affects process memory access, debugging, and credential harvesting capability",
    args: "",
  },
  cron_persist: {
    description:
      "Establish cron-based persistence — add crontab entries or drop files in /etc/cron.d/ for scheduled command execution as root or target user",
    args: "--command CMD [--schedule CRON_EXPR] [--user USER]",
  },
  systemd_persist: {
    description:
      "Create systemd service/timer for persistence — persistent service that auto-starts on boot, with optional timer for periodic execution",
    args: "--command CMD [--name NAME] [--timer INTERVAL]",
  },
  bashrc_persist: {
    description:
      "Add persistence to shell RC files — inject commands into .bashrc, .profile, .bash_profile, .zshrc that execute on every shell session start",
    args: "--command CMD [--user USER] [--file bashrc|profile|zshrc]",
  },
  ssh_authorized_keys: {
    description:
      "Add SSH authorized key for persistent access — inject public key into target user's ~/.ssh/authorized_keys with optional command restriction and environment",
    args: "--key PUBKEY [--user USER] [--command CMD]",
  },
  ld_so_preload: {
    description:
      "Persist via /etc/ld.so.preload — inject shared library that loads into every dynamically-linked process on the system. Extremely powerful but high-visibility",
    args: "--library PATH",
  },
  sysvinit_persist: {
    description:
      "Create SysV init script for persistence — /etc/init.d/ script with proper LSB headers, auto-enabled via update-rc.d or chkconfig",
    args: "--command CMD [--name NAME]",
  },
  at_job_persist: {
    description:
      "Schedule one-time persistence via at — create delayed command execution that survives reboots if atd is running",
    args: "--command CMD [--time TIME]",
  },
  udev_rules_persist: {
    description:
      "Create udev rules for persistence — trigger command execution on device events (USB insert, network interface up, etc.) via /etc/udev/rules.d/",
    args: "--command CMD [--trigger DEVICE_EVENT]",
  },
  pam_backdoor: {
    description:
      "Install PAM backdoor — modify PAM configuration to accept a master password or always authenticate successfully. Affects SSH, su, sudo, login",
    args: "--password MASTER_PASS [--service sshd|su|sudo|login]",
  },
  motd_persist: {
    description:
      "Persist via MOTD scripts — add executable to /etc/update-motd.d/ that runs as root on every user login (SSH, console, GUI)",
    args: "--command CMD [--name NAME]",
  },
  xdg_autostart: {
    description:
      "Create XDG autostart entry — .desktop file in /etc/xdg/autostart/ or ~/.config/autostart/ that runs on graphical session start",
    args: "--command CMD [--name NAME] [--user USER]",
  },
  git_hook_persist: {
    description:
      "Install Git hook persistence — inject commands into repository hooks (post-commit, pre-push, post-checkout) that execute during git operations",
    args: "--command CMD --repo PATH [--hook post-commit|pre-push|post-checkout]",
  },
  kernel_module_persist: {
    description:
      "Load persistent kernel module — compile and install custom kernel module that auto-loads on boot via /etc/modules or modprobe.d configuration",
    args: "--module PATH [--name NAME]",
  },
  apt_hook_persist: {
    description:
      "Install APT hook for persistence — execute commands before/after every apt/apt-get operation via /etc/apt/apt.conf.d/ DPkg::Pre-Invoke or Post-Invoke",
    args: "--command CMD [--trigger pre|post]",
  },
  dpkg_trigger_persist: {
    description:
      "Install dpkg trigger for persistence — execute commands when specific packages are installed/updated via dpkg trigger mechanism",
    args: "--command CMD [--package PACKAGE]",
  },
  socket_activation: {
    description:
      "Create systemd socket-activated service — listen on a port and spawn handler on connection, providing on-demand persistence",
    args: "--command CMD --port PORT [--name NAME]",
  },
  user_service_persist: {
    description:
      "Create user-level systemd service — persistence without root via ~/.config/systemd/user/ (requires lingering enabled)",
    args: "--command CMD [--name NAME] [--user USER]",
  },
  xinetd_persist: {
    description:
      "Create xinetd service for persistence — on-demand service that spawns on incoming connection, configured via /etc/xinetd.d/",
    args: "--command CMD --port PORT [--name NAME]",
  },
  rc_local_persist: {
    description:
      "Persist via /etc/rc.local — add commands to the legacy boot script that runs at the end of multi-user boot (before login prompt)",
    args: "--command CMD",
  },
  logrotate_persist: {
    description:
      "Persist via logrotate configuration — execute commands during log rotation via postrotate/prerotate scripts in /etc/logrotate.d/",
    args: "--command CMD [--log PATH]",
  },
  ssh_rc_persist: {
    description:
      "Persist via SSH RC files — inject commands into /etc/ssh/sshrc or ~/.ssh/rc that execute on every SSH login before the shell",
    args: "--command CMD [--user USER]",
  },
  ld_config_persist: {
    description:
      "Persist via ld.so.conf — add custom library path to /etc/ld.so.conf.d/ for library hijacking across all dynamically-linked processes",
    args: "--library-path PATH",
  },
  ssh_pivot: {
    description:
      "SSH-based lateral movement — key-based or password authentication to remote hosts, SSH agent forwarding abuse, ProxyJump chains for multi-hop pivoting",
    args: "--target HOST [--user USER] [--key PATH] [--command CMD]",
  },
  ansible_abuse: {
    description:
      "Exploit Ansible for lateral movement — abuse existing Ansible infrastructure to execute commands on managed nodes, extract vault secrets, modify playbooks",
    args: "[--inventory PATH] [--target HOST] [--command CMD]",
  },
  puppet_abuse: {
    description:
      "Exploit Puppet for lateral movement — abuse Puppet agent/master trust to execute code, extract certificates and secrets, modify manifests",
    args: "[--target HOST] [--command CMD]",
  },
  salt_abuse: {
    description:
      "Exploit SaltStack for lateral movement — abuse Salt master to execute commands on minions, extract pillar secrets, and leverage Salt API",
    args: "[--target MINION] [--command CMD]",
  },
  nfs_mount_attack: {
    description:
      "Exploit NFS shares for lateral movement — mount remote NFS exports, access sensitive files, create SUID binaries for privilege escalation on NFS clients",
    args: "--target HOST [--share PATH]",
  },
  rsync_exploit: {
    description:
      "Exploit rsync for data access and lateral movement — enumerate rsync modules, download sensitive files, exploit anonymous rsync access",
    args: "--target HOST [--module MODULE]",
  },
  ssh_tunnel: {
    description:
      "Create SSH tunnels for network pivoting — local port forward (-L), remote port forward (-R), dynamic SOCKS proxy (-D) through compromised SSH hosts",
    args: "--target HOST --type local|remote|dynamic [--local-port PORT] [--remote-port PORT] [--user USER]",
  },
  socat_tunnel: {
    description:
      "Create socat tunnels for network pivoting — TCP/UDP forwarding, SSL/TLS encrypted tunnels, and bidirectional data relay through compromised hosts",
    args: "--listen PORT --connect HOST:PORT [--ssl]",
  },
  internal_scan: {
    description:
      "Scan internal network from compromised host — ping sweep, port scan, service detection using native tools (bash /dev/tcp, nc, nmap if available)",
    args: "--target CIDR [--ports PORTS] [--type ping|port|service]",
  },
  proxychains_setup: {
    description:
      "Configure proxychains for tunneled network access — set up proxychains.conf with SOCKS4/5 proxy chain for routing tools through SSH tunnels",
    args: "--proxy HOST:PORT [--type socks4|socks5]",
  },
  log_tamper: {
    description:
      "Tamper with system logs — selectively remove entries from auth.log, syslog, wtmp, btmp, lastlog, and journal. More stealthy than clearing entire logs",
    args: "[--user USER] [--ip IP] [--after DATETIME]",
  },
  history_clear: {
    description:
      "Clear shell history — remove bash/zsh/sh history files, unset HISTFILE, configure history to not record commands for current and future sessions",
    args: "[--user USER]",
  },
  timestomp: {
    description:
      "Modify file timestamps — change atime, mtime, ctime to blend with legitimate files. Use --reference to copy timestamps from another file",
    args: "--target PATH [--reference PATH] [--timestamp 'YYYY-MM-DD HH:mm:ss']",
  },
  auditd_evade: {
    description:
      "Evade auditd monitoring — check audit rules, stop auditd service, modify audit rules to exclude attacker activity, and fill audit log buffer to cause drops",
    args: "[--action check|stop|modify|flood]",
  },
  selinux_bypass: {
    description:
      "Bypass SELinux enforcement — set permissive mode (requires root), exploit permissive domains, find unconfined processes, and check for known SELinux bypasses",
    args: "[--action check|permissive|exploit]",
  },
  apparmor_bypass: {
    description:
      "Bypass AppArmor enforcement — set profiles to complain mode, find unconfined processes, exploit profile gaps, and disable profiles for specific binaries",
    args: "[--action check|complain|disable] [--profile PROFILE]",
  },
  rootkit_detect: {
    description:
      "Detect existing rootkits — check for hidden processes, kernel module anomalies, LD_PRELOAD hooks, /etc/ld.so.preload, hidden files, modified system binaries (hash comparison)",
    args: "[--deep]",
  },
  process_hide: {
    description:
      "Hide processes from enumeration — mount overlay on /proc/PID, use LD_PRELOAD to hook readdir, or rename process via prctl PR_SET_NAME",
    args: "--pid PID [--method mount|preload|rename]",
  },
  file_hide: {
    description:
      "Hide files from directory listings — use extended attributes, mount overlays, LD_PRELOAD hooks on readdir/stat, or dot-prefix naming",
    args: "--path PATH [--method xattr|mount|preload|dot]",
  },
  network_hide: {
    description:
      "Hide network connections — manipulate /proc/net/tcp to remove entries, use LD_PRELOAD to hook getaddrinfo, or iptables rules to hide traffic",
    args: "--port PORT [--method proc|preload|iptables]",
  },
  syslog_manipulate: {
    description:
      "Manipulate syslog — redirect syslog to /dev/null, modify rsyslog/syslog-ng configs to filter attacker activity, inject fake log entries",
    args: "[--action redirect|filter|inject] [--pattern PATTERN]",
  },
  stealth_check_linux: {
    description:
      "Verify stealth capability on Linux — test exec methods (bash, sh, python3, perl, busybox), stealth modes (base64, memfd, shm), and report working combinations",
    args: "",
  },
  data_stage: {
    description:
      "Stage data for exfiltration — find sensitive files, compress and encrypt into staging archive, optionally split into chunks for transfer",
    args: "--path PATH [--output PATH] [--password KEY] [--chunk-size SIZE]",
  },
  dns_tunnel_exfil: {
    description:
      "Exfiltrate data via DNS queries — encode data in subdomain labels of DNS queries to attacker-controlled authoritative DNS server",
    args: "--file PATH --domain DOMAIN [--chunk-size SIZE]",
  },
  icmp_exfil: {
    description:
      "Exfiltrate data via ICMP echo requests — hide data in ICMP payload, requires raw socket (root) or ping with pattern option",
    args: "--file PATH --target IP [--chunk-size SIZE]",
  },
  covert_channel: {
    description:
      "Establish covert communication channel — use timing-based, storage-based, or protocol-based covert channels for stealthy command and control",
    args: "--type timing|storage|protocol --target HOST [--port PORT]",
  },
  https_exfil: {
    description:
      "Exfiltrate data via HTTPS POST — upload files to attacker-controlled endpoint over TLS, supports chunked transfer and custom headers",
    args: "--file PATH --url URL [--header HEADER]",
  },
  cleanup_linux: {
    description:
      "Remove CyberStrike artifacts from Linux target — clear logs, remove persistence mechanisms, restore modified configs, clean temp files. ALWAYS run before leaving",
    args: "",
  },
  artifact_enum: {
    description:
      "Enumerate forensic artifacts — list files modified during engagement, temporary files, new users/services/cron jobs, and other indicators of compromise",
    args: "[--since DATETIME]",
  },
  steganography_exfil: {
    description:
      "Exfiltrate data via steganography — hide data within image/audio files using LSB encoding, making exfiltration appear as normal file transfers",
    args: "--file PATH --cover IMAGE_PATH [--output PATH]",
  },
  arp_spoof: {
    description:
      "ARP spoofing for MITM — send gratuitous ARP replies to poison target's ARP cache, enabling traffic interception between target and gateway",
    args: "--target IP --gateway IP [--interface IFACE] [--duration SECONDS]",
  },
  dns_spoof: {
    description:
      "DNS spoofing — intercept DNS queries and respond with attacker-controlled IP addresses for phishing or traffic redirection",
    args: "--domain DOMAIN --ip IP [--interface IFACE]",
  },
  packet_capture: {
    description:
      "Capture network packets — use tcpdump, tshark, or raw sockets to capture traffic on specified interface with optional BPF filters",
    args: "[--interface IFACE] [--filter BPF] [--duration SECONDS] [--output PATH]",
  },
  port_scan_native: {
    description:
      "Port scan using native tools — bash /dev/tcp, nc, or nmap if available. Supports TCP connect, SYN (nmap), and UDP scanning",
    args: "--target HOST [--ports PORTS] [--type tcp|syn|udp]",
  },
  mitm_proxy: {
    description:
      "Set up MITM proxy — configure transparent proxy or iptables REDIRECT for traffic interception, SSL stripping, and credential capture",
    args: "--port PORT [--target IP] [--ssl-strip]",
  },
  responder_linux: {
    description:
      "LLMNR/NBT-NS/mDNS poisoning on Linux — capture NTLMv2 hashes from Windows clients on the local network by responding to broadcast name resolution",
    args: "[--interface IFACE] [--duration SECONDS]",
  },
  firewall_enum: {
    description:
      "Enumerate firewall rules — iptables, nftables, ufw, firewalld rules and policies. Identify open ports, allowed services, and bypass opportunities",
    args: "[--verbose]",
  },
  traffic_redirect: {
    description:
      "Redirect network traffic — iptables DNAT/SNAT rules for port forwarding, traffic interception, and pivoting through compromised host",
    args: "--src-port PORT --dst HOST:PORT [--protocol tcp|udp]",
  },
  wifi_attack: {
    description:
      "WiFi attacks — enumerate wireless interfaces, scan networks, deauth clients, capture handshakes for offline cracking (requires monitor mode)",
    args: "--action scan|deauth|capture [--interface IFACE] [--bssid BSSID]",
  },
  ipv6_attack: {
    description:
      "IPv6 network attacks — RA spoofing, DHCPv6 poisoning, SLAAC abuse, neighbor discovery, multicast scan. Windows prefers IPv6 → effective even on IPv4-primary networks",
    args: "--action scan|ra_spoof|dhcpv6|slaac [--interface IFACE] [--target IP] [--domain DOMAIN]",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS

const dispatch: Record<Program, (args: string[], timeout: number) => Promise<HookResult>> = {
  detect_env: async (_args: string[], timeout: number): Promise<HookResult> => {
    const env = await detectEnv(timeout)
    const lines = [
      "=== LINUX ENVIRONMENT DETECTION ===",
      "",
      `Shell: ${env.shell}`,
      `Bash: ${env.bashAvailable ? "AVAILABLE" : "NOT FOUND"}`,
      `sh: ${env.shAvailable ? "AVAILABLE" : "NOT FOUND"}`,
      `Python3: ${env.python3Available ? "AVAILABLE" : "NOT FOUND"}`,
      `Perl: ${env.perlAvailable ? "AVAILABLE" : "NOT FOUND"}`,
      `BusyBox: ${env.busyboxAvailable ? "AVAILABLE" : "NOT FOUND"}`,
      "",
      `Root: ${env.isRoot ? "YES (uid=0)" : `NO (uid=${env.uid})`}`,
      `Sudo: ${env.sudoAvailable ? (env.sudoNopasswd ? "AVAILABLE (NOPASSWD)" : "AVAILABLE (password required)") : "NOT FOUND"}`,
      "",
      `Kernel: ${env.kernelVersion} (${env.kernelMajor}.${env.kernelMinor})`,
      `Distro: ${env.distro} ${env.distroVersion}`,
      `Arch: ${env.arch}`,
      "",
      `SELinux: ${env.selinuxStatus}`,
      `AppArmor: ${env.apparmorStatus}`,
      `Container: ${env.inContainer ? `YES (${env.containerType})` : "NO"}`,
      `Init System: ${env.initSystem}`,
      `Package Manager: ${env.packageManager}`,
      "",
      "=== TOOL AVAILABILITY ===",
      `curl: ${env.hasCurl ? "YES" : "NO"}`,
      `wget: ${env.hasWget ? "YES" : "NO"}`,
      `netcat: ${env.hasNetcat ? "YES" : "NO"}`,
      `socat: ${env.hasSocat ? "YES" : "NO"}`,
      `nmap: ${env.hasNmap ? "YES" : "NO"}`,
      `gcc: ${env.hasGcc ? "YES" : "NO"}`,
      "",
      `Recommended --exec method: ${env.recommendedExec}`,
      "",
      "=== EXEC FALLBACK CHAIN ===",
      env.bashAvailable ? "1. bash [AVAILABLE]" : "1. bash [NOT FOUND]",
      "2. sh [AVAILABLE]",
      env.python3Available ? "3. python3 [AVAILABLE]" : "3. python3 [NOT FOUND]",
      env.perlAvailable ? "4. perl [AVAILABLE]" : "4. perl [NOT FOUND]",
      env.busyboxAvailable ? "5. busybox [AVAILABLE]" : "5. busybox [NOT FOUND]",
      "",
      "Use: linuxhook <program> --exec auto   (auto-select best method)",
      "Use: linuxhook <program> --exec sh     (force POSIX sh)",
    ]
    const findings: Finding[] = []
    if (!env.bashAvailable)
      findings.push({
        checkId: "LNX-ENV-BASH",
        provider: "linuxhook",
        severity: "MEDIUM",
        status: "WARN",
        resource: "bash",
        title: "Bash not available",
        details:
          "bash is not accessible — some handlers will use sh fallback with reduced functionality. Use --exec auto.",
        remediation: "Use --exec sh or --exec python3 for fallback",
      })
    if (!env.isRoot && !env.sudoNopasswd)
      findings.push({
        checkId: "LNX-ENV-ROOT",
        provider: "linuxhook",
        severity: "HIGH",
        status: "WARN",
        resource: "privileges",
        title: "Not running as root and no NOPASSWD sudo",
        details:
          "Many post-exploitation operations require root or passwordless sudo. Credential and persistence operations will be limited.",
        remediation: "Escalate privileges first using linuxhook privesc programs",
      })
    if (env.selinuxStatus === "enforcing")
      findings.push({
        checkId: "LNX-ENV-SELINUX",
        provider: "linuxhook",
        severity: "MEDIUM",
        status: "WARN",
        resource: "SELinux",
        title: "SELinux is enforcing",
        details:
          "SELinux enforcement may block some operations. Use linuxhook selinux_bypass to assess bypass options.",
        remediation: "Run linuxhook selinux_bypass --action check",
      })
    if (env.inContainer)
      findings.push({
        checkId: "LNX-ENV-CONTAINER",
        provider: "linuxhook",
        severity: "LOW",
        status: "INFO",
        resource: env.containerType,
        title: `Running inside ${env.containerType} container`,
        details:
          "Container environment detected — some host-level operations will be unavailable. Consider container escape via containerhook.",
        remediation: "Use containerhook for container-specific attacks, or escape to host first",
      })
    return { output: lines.join("\n"), findings }
  },
  system_info: systemInfo,
  process_enum: processEnum,
  network_enum: networkEnum,
  user_enum: userEnum,
  service_enum: serviceEnum,
  package_enum: packageEnum,
  container_detect: containerDetect,
  security_framework: securityFramework,
  interesting_files: interestingFiles,
  mount_enum: mountEnum,
  kernel_module_enum: kernelModuleEnum,
  local_recon_linux: localReconLinux,
  shadow_dump: shadowDump,
  ssh_key_harvest: sshKeyHarvest,
  bash_history_secrets: bashHistorySecrets,
  gnome_keyring_dump: gnomeKeyringDump,
  kwallet_dump: kwalletDump,
  browser_creds_linux: browserCredsLinux,
  env_secrets: envSecrets,
  proc_memory_harvest: procMemoryHarvest,
  gpg_key_extract: gpgKeyExtract,
  cloud_cred_harvest: cloudCredHarvest,
  docker_config_creds: dockerConfigCreds,
  git_cred_harvest: gitCredHarvest,
  wifi_creds_nm: wifiCredsNm,
  kerberos_keytab: kerberosKeytab,
  db_cred_harvest: dbCredHarvest,
  vnc_password: vncPassword,
  mail_spool_harvest: mailSpoolHarvest,
  netrc_harvest: netrcHarvest,
  ldap_cred_harvest: ldapCredHarvest,
  credential_files_scan: credentialFilesScan,
  sudo_misconfig: sudoMisconfig,
  suid_sgid_scan: suidSgidScan,
  capabilities_abuse: capabilitiesAbuse,
  cron_privesc: cronPrivesc,
  nfs_no_root_squash: nfsNoRootSquash,
  path_hijack: pathHijack,
  ld_preload_abuse: ldPreloadAbuse,
  kernel_exploit_check: kernelExploitCheck,
  writable_passwd: writablePasswd,
  pkexec_cve: pkexecCve,
  systemd_unit_abuse: systemdUnitAbuse,
  dbus_exploit: dbusExploit,
  pip_setup_abuse: pipSetupAbuse,
  shared_lib_hijack: sharedLibHijack,
  logrotate_race: logrotateRace,
  writable_service_bin: writableServiceBin,
  polkit_bypass: polkitBypass,
  snap_privesc: snapPrivesc,
  docker_group_escape: dockerGroupEscape,
  lxd_group_escape: lxdGroupEscape,
  python_lib_hijack: pythonLibHijack,
  motd_abuse: motdAbuse,
  wildcard_injection: wildcardInjection,
  mysql_udf: mysqlUdf,
  ptrace_scope_check: ptraceScopeCheck,
  cron_persist: cronPersist,
  systemd_persist: systemdPersist,
  bashrc_persist: bashrcPersist,
  ssh_authorized_keys: sshAuthorizedKeys,
  ld_so_preload: ldSoPreload,
  sysvinit_persist: sysvinitPersist,
  at_job_persist: atJobPersist,
  udev_rules_persist: udevRulesPersist,
  pam_backdoor: pamBackdoor,
  motd_persist: motdPersist,
  xdg_autostart: xdgAutostart,
  git_hook_persist: gitHookPersist,
  kernel_module_persist: kernelModulePersist,
  apt_hook_persist: aptHookPersist,
  dpkg_trigger_persist: dpkgTriggerPersist,
  socket_activation: socketActivation,
  user_service_persist: userServicePersist,
  xinetd_persist: xinetdPersist,
  rc_local_persist: rcLocalPersist,
  logrotate_persist: logrotatePersist,
  ssh_rc_persist: sshRcPersist,
  ld_config_persist: ldConfigPersist,
  ssh_pivot: sshPivot,
  ansible_abuse: ansibleAbuse,
  puppet_abuse: puppetAbuse,
  salt_abuse: saltAbuse,
  nfs_mount_attack: nfsMountAttack,
  rsync_exploit: rsyncExploit,
  ssh_tunnel: sshTunnel,
  socat_tunnel: socatTunnel,
  internal_scan: internalScan,
  proxychains_setup: proxychainsSetup,
  log_tamper: logTamper,
  history_clear: historyClear,
  timestomp: timestomp,
  auditd_evade: auditdEvade,
  selinux_bypass: selinuxBypass,
  apparmor_bypass: apparmorBypass,
  rootkit_detect: rootkitDetect,
  process_hide: processHide,
  file_hide: fileHide,
  network_hide: networkHide,
  syslog_manipulate: syslogManipulate,
  stealth_check_linux: stealthCheckLinux,
  data_stage: dataStage,
  dns_tunnel_exfil: dnsTunnelExfil,
  icmp_exfil: icmpExfil,
  covert_channel: covertChannel,
  https_exfil: httpsExfil,
  cleanup_linux: cleanupLinux,
  artifact_enum: artifactEnum,
  steganography_exfil: steganographyExfil,
  arp_spoof: arpSpoof,
  dns_spoof: dnsSpoof,
  packet_capture: packetCapture,
  port_scan_native: portScanNative,
  mitm_proxy: mitmProxy,
  responder_linux: responderLinux,
  firewall_enum: firewallEnum,
  traffic_redirect: trafficRedirect,
  wifi_attack: wifiAttack,
  ipv6_attack: ipv6Attack,
}

const CWE_MAP: Record<string, string> = {
  "LNX-SHADOW": "CWE-522",
  "LNX-SSH": "CWE-522",
  "LNX-SSHPIVOT": "CWE-78",
  "LNX-SSHRC": "CWE-269",
  "LNX-HISTORY": "CWE-312",
  "LNX-KEYRING": "CWE-312",
  "LNX-KWALLET": "CWE-312",
  "LNX-BROWSER": "CWE-312",
  "LNX-ENV": "CWE-312",
  "LNX-PROC": "CWE-316",
  "LNX-GPG": "CWE-312",
  "LNX-CLOUD": "CWE-312",
  "LNX-DOCKER": "CWE-312",
  "LNX-GIT": "CWE-312",
  "LNX-WIFI": "CWE-312",
  "LNX-KRB": "CWE-522",
  "LNX-DB": "CWE-312",
  "LNX-VNC": "CWE-312",
  "LNX-MAIL": "CWE-200",
  "LNX-NETRC": "CWE-312",
  "LNX-LDAP": "CWE-312",
  "LNX-CRED": "CWE-312",
  "LNX-SUDO": "CWE-269",
  "LNX-SUID": "CWE-269",
  "LNX-CAP": "CWE-269",
  "LNX-CRON": "CWE-269",
  "LNX-NFS": "CWE-269",
  "LNX-NFSMNT": "CWE-269",
  "LNX-PATH": "CWE-426",
  "LNX-LDPRELOAD": "CWE-426",
  "LNX-LDSOPRELOAD": "CWE-426",
  "LNX-LDCONF": "CWE-426",
  "LNX-KERNEL": "CWE-269",
  "LNX-PASSWD": "CWE-269",
  "LNX-PKEXEC": "CWE-269",
  "LNX-SYSTEMD": "CWE-269",
  "LNX-DBUS": "CWE-269",
  "LNX-PIP": "CWE-269",
  "LNX-SHLIB": "CWE-426",
  "LNX-LOGROT": "CWE-269",
  "LNX-LOGROTATE": "CWE-269",
  "LNX-WRITSVC": "CWE-269",
  "LNX-POLKIT": "CWE-269",
  "LNX-SNAP": "CWE-269",
  "LNX-DOCKERGRP": "CWE-269",
  "LNX-LXDGRP": "CWE-269",
  "LNX-PYLIB": "CWE-426",
  "LNX-MOTD": "CWE-269",
  "LNX-MOTDP": "CWE-269",
  "LNX-WILDCARD": "CWE-78",
  "LNX-MYSQLUDF": "CWE-269",
  "LNX-PTRACE": "CWE-269",
  "LNX-CRONP": "CWE-269",
  "LNX-SYSDP": "CWE-269",
  "LNX-BASHRC": "CWE-269",
  "LNX-AUTHKEYS": "CWE-269",
  "LNX-INITP": "CWE-269",
  "LNX-ATJOB": "CWE-269",
  "LNX-UDEV": "CWE-269",
  "LNX-PAM": "CWE-287",
  "LNX-XDG": "CWE-269",
  "LNX-GITHOOK": "CWE-269",
  "LNX-KMOD": "CWE-269",
  "LNX-KMODULES": "CWE-200",
  "LNX-APT": "CWE-269",
  "LNX-DPKG": "CWE-269",
  "LNX-SOCKET": "CWE-269",
  "LNX-USERSVC": "CWE-269",
  "LNX-XINETD": "CWE-269",
  "LNX-RCLOCAL": "CWE-269",
  "LNX-ANSIBLE": "CWE-78",
  "LNX-PUPPET": "CWE-78",
  "LNX-SALT": "CWE-78",
  "LNX-RSYNC": "CWE-200",
  "LNX-TUNNEL": "CWE-918",
  "LNX-LOGTAMP": "CWE-1254",
  "LNX-HISTCLR": "CWE-1254",
  "LNX-TIMESTOMP": "CWE-1254",
  "LNX-AUDITD": "CWE-693",
  "LNX-SELINUX": "CWE-693",
  "LNX-APPARMOR": "CWE-693",
  "LNX-ROOTKIT": "CWE-693",
  "LNX-HIDE": "CWE-693",
  "LNX-NETHIDE": "CWE-693",
  "LNX-SYSLOG": "CWE-1254",
  "LNX-STEALTH": "CWE-693",
  "LNX-STAGE": "CWE-200",
  "LNX-DNSTUN": "CWE-200",
  "LNX-ICMPEX": "CWE-200",
  "LNX-COVERT": "CWE-200",
  "LNX-HTTPEX": "CWE-200",
  "LNX-CLEANUP": "CWE-1254",
  "LNX-ARTIFACT": "CWE-200",
  "LNX-STEGO": "CWE-200",
  "LNX-ARP": "CWE-350",
  "LNX-DNSSPOOF": "CWE-350",
  "LNX-PCAP": "CWE-319",
  "LNX-PORTSCAN": "CWE-200",
  "LNX-MITM": "CWE-294",
  "LNX-RESPONDER": "CWE-350",
  "LNX-FW": "CWE-200",
  "LNX-REDIRECT": "CWE-918",
  "LNX-WIFIATT": "CWE-319",
  "LNX-NET-IPV6": "CWE-940",
  "LNX-RECON": "CWE-200",
  "LNX-SYSINFO": "CWE-200",
  "LNX-PROCS": "CWE-200",
  "LNX-NETWORK": "CWE-200",
  "LNX-USERS": "CWE-200",
  "LNX-SERVICES": "CWE-200",
  "LNX-PACKAGES": "CWE-200",
  "LNX-CONTAINER": "CWE-200",
  "LNX-SECFW": "CWE-693",
  "LNX-FILES": "CWE-200",
  "LNX-MOUNTS": "CWE-200",
}

function resolveCwe(checkId: string): string | undefined {
  for (const prefix of Object.keys(CWE_MAP).sort((a, b) => b.length - a.length)) {
    if (checkId.startsWith(prefix)) return CWE_MAP[prefix]
  }
  return undefined
}

const BASH_FAILURE_PATTERNS = [
  "command not found",
  "Permission denied",
  "No such file or directory",
  "not found",
  "bash: ",
  "Operation not permitted",
  "cannot execute binary file",
  "syntax error",
]

function isBashFailure(output: string): boolean {
  if (output.length === 0) return true
  const lower = output.toLowerCase()
  return BASH_FAILURE_PATTERNS.some((p) => lower.includes(p.toLowerCase()))
}

const envChangingPrograms = new Set(["selinux_bypass", "apparmor_bypass", "auditd_evade"])

export const LinuxhookTool = Tool.define("linuxhook", {
  description: `Execute a Linux post-exploitation program. Covers reconnaissance (system, process, network, user, service enumeration), credential harvesting (shadow, SSH keys, history secrets, keyrings, browser, environment, GPG, cloud, database, VNC, mail, LDAP), privilege escalation (sudo, SUID/SGID, capabilities, cron, NFS, PATH hijack, LD_PRELOAD, kernel exploits, writable passwd, pkexec, systemd, D-Bus, Docker/LXD group escape), persistence (cron, systemd, bashrc, SSH keys, ld.so.preload, udev, PAM, MOTD, apt/dpkg hooks, kernel modules, socket activation), lateral movement (SSH pivot, Ansible, Puppet, Salt, NFS, rsync, tunnels), evasion (log tamper, history clear, timestomp, auditd/SELinux/AppArmor bypass, rootkit detection, process/file/network hiding), exfiltration (staging, DNS tunnel, ICMP, HTTPS, covert channels, steganography), and network attacks (ARP/DNS spoofing, packet capture, port scanning, MITM, firewall enum). Requires root for most operations. ALWAYS run detect_env first to check available tools and exec methods. Use --exec auto for automatic fallback (bash → sh → python3 → perl → busybox). Available programs: ${Object.keys(PROGRAMS).join(", ")}. ALWAYS run cleanup_linux before leaving a target.`,
  parameters: z.object({
    program: z
      .enum(Object.keys(PROGRAMS) as [string, ...string[]])
      .describe("Program name. Run with no args to see usage. Full list in tool description."),
    args: z
      .array(z.string())
      .describe(
        "Arguments to pass to the program. Use --stealth <mode> for evasion: base64 (echo|base64 -d|bash), memfd (python3 memfd_create fileless exec), shm (/dev/shm tmpfs). Use --exec <method> for execution engine: bash (default), sh (POSIX), python3, perl, busybox, auto (detect best available)",
      ),
    timeout_seconds: z.number().optional().default(120).describe("Maximum execution time in seconds (default: 120)"),
  }),
  async execute(params) {
    if (process.platform !== "linux") {
      return {
        title: `linuxhook: ${params.program}`,
        output: `linuxhook requires Linux. Current platform: ${process.platform}\n\nUse 'winhook' for Windows post-exploitation or 'machook' for macOS.`,
        metadata: { program: params.program, findings: [] as Finding[] },
      }
    }

    setStealthState(argVal(params.args, "--stealth") as StealthMode | undefined)
    const requestedExec = (argVal(params.args, "--exec") as ExecMethod) || "bash"

    if (requestedExec === "auto") {
      const env = await detectEnv(params.timeout_seconds)
      setExecMethod(resolveExec("auto", env))
    } else {
      setExecMethod(requestedExec)
    }

    const program = params.program as Program
    const handler = dispatch[program]
    let result = await handler(params.args, params.timeout_seconds)

    if (activeExec === "bash" && isBashFailure(result.output)) {
      const env = await detectEnv(params.timeout_seconds)
      const fallback = resolveExec("auto", env)
      if (fallback !== "bash") {
        setExecMethod(fallback)
        const retry = await handler(params.args, params.timeout_seconds)
        result = {
          output: `[!] Bash failed — auto-fallback to ${fallback}\n\n${retry.output}`,
          findings: retry.findings,
        }
      }
    }

    if (envChangingPrograms.has(program)) resetEnvCache()

    setStealthState(undefined)
    setExecMethod("bash")

    const enriched = result.findings.map((f) => ({
      ...f,
      severity: f.severity.toLowerCase(),
      cwe: f.cwe || resolveCwe(f.checkId),
    }))
    const output =
      enriched.length > 0
        ? result.output +
          "\n\n=== FINDINGS (" +
          enriched.length +
          ") ===\n" +
          enriched
            .map(
              (f, i) =>
                `[${i + 1}] ${f.severity} — ${f.title}${f.cwe ? ` (${f.cwe})` : ""}\n    Check: ${f.checkId} | Status: ${f.status} | Resource: ${f.resource}\n    ${f.details}\n    Remediation: ${f.remediation}`,
            )
            .join("\n") +
          "\n\nCall report_vulnerability for each finding: severity (lowercase), title, description=details, recommendation=remediation" +
          (enriched.some((f) => f.cwe) ? ", cwe_id from parentheses above" : "") +
          "."
        : result.output

    return {
      title: `linuxhook: ${program}`,
      output,
      metadata: { program, findings: enriched },
    }
  },
})
