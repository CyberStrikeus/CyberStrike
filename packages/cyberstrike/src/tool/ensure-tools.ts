import z from "zod"
import { Tool } from "./tool"

const TOOL_INSTALL_MAP: Record<string, { check: string; install: string; description: string }> = {
  nmap: { check: "nmap", install: "brew install nmap || apt-get install -y nmap", description: "Network scanner" },
  nuclei: {
    check: "nuclei",
    install: "go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest",
    description: "Vulnerability scanner",
  },
  ffuf: { check: "ffuf", install: "go install github.com/ffuf/ffuf/v2@latest", description: "Web fuzzer" },
  httpx: {
    check: "httpx",
    install: "go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest",
    description: "HTTP toolkit",
  },
  subfinder: {
    check: "subfinder",
    install: "go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest",
    description: "Subdomain discovery",
  },
  amass: {
    check: "amass",
    install: "go install -v github.com/owasp-amass/amass/v4/...@master",
    description: "Attack surface mapping",
  },
  waybackurls: {
    check: "waybackurls",
    install: "go install github.com/tomnomnom/waybackurls@latest",
    description: "Wayback Machine URL fetcher",
  },
  gau: { check: "gau", install: "go install github.com/lc/gau/v2/cmd/gau@latest", description: "URL aggregator" },
  hakrawler: {
    check: "hakrawler",
    install: "go install github.com/hakluke/hakrawler@latest",
    description: "Web crawler",
  },
  katana: {
    check: "katana",
    install: "go install github.com/projectdiscovery/katana/cmd/katana@latest",
    description: "Next-gen crawler",
  },
  dalfox: { check: "dalfox", install: "go install github.com/hahwul/dalfox/v2@latest", description: "XSS scanner" },
  sqlmap: { check: "sqlmap", install: "pip3 install sqlmap", description: "SQL injection tool" },
  nikto: {
    check: "nikto",
    install: "brew install nikto || apt-get install -y nikto",
    description: "Web server scanner",
  },
  wpscan: { check: "wpscan", install: "gem install wpscan || brew install wpscan", description: "WordPress scanner" },
  gospider: {
    check: "gospider",
    install: "go install github.com/jaeles-project/gospider@latest",
    description: "Web spidering",
  },
  arjun: { check: "arjun", install: "pip3 install arjun", description: "Parameter discovery" },
  paramspider: { check: "paramspider", install: "pip3 install paramspider", description: "Parameter mining" },
  commix: { check: "commix", install: "pip3 install commix", description: "Command injection" },
  ssrfmap: { check: "ssrfmap", install: "pip3 install ssrfmap", description: "SSRF exploitation" },
  nosqlmap: { check: "nosqlmap", install: "pip3 install nosqlmap", description: "NoSQL injection" },
  crlfuzz: {
    check: "crlfuzz",
    install: "go install github.com/dwisiswant0/crlfuzz/cmd/crlfuzz@latest",
    description: "CRLF injection scanner",
  },
  gitdumper: { check: "git-dumper", install: "pip3 install git-dumper", description: "Git repository dumper" },
}

export const EnsureToolsTool = Tool.define("ensure_tools", {
  description:
    "Check if required security tools are installed and install missing ones. Supports 22 common security tools including nmap, nuclei, ffuf, httpx, subfinder, sqlmap, and more. Run this before starting a pentest to ensure all needed tools are available.",
  parameters: z.object({
    tools: z
      .array(z.string())
      .describe(`Tools to check/install. Available: ${Object.keys(TOOL_INSTALL_MAP).join(", ")}`),
  }),
  async execute(params) {
    const results: Array<{ tool: string; installed: boolean; action: string }> = []

    for (const name of params.tools) {
      const spec = TOOL_INSTALL_MAP[name]
      if (!spec) {
        results.push({ tool: name, installed: false, action: `Unknown tool: ${name}` })
        continue
      }

      // Check if installed
      const check = Bun.spawnSync(["which", spec.check])
      if (check.exitCode === 0) {
        results.push({ tool: name, installed: true, action: `Already installed: ${check.stdout.toString().trim()}` })
        continue
      }

      // Try to install
      const install = Bun.spawnSync(["sh", "-c", spec.install], { timeout: 120_000 })
      if (install.exitCode === 0) {
        results.push({ tool: name, installed: true, action: `Installed successfully` })
      } else {
        const stderr = install.stderr.toString().trim().slice(0, 200)
        results.push({ tool: name, installed: false, action: `Install failed: ${stderr}` })
      }
    }

    const installed = results.filter((r) => r.installed).length
    const failed = results.filter((r) => !r.installed).length

    const output = [
      `Tool check: ${installed} ready, ${failed} failed`,
      "",
      ...results.map((r) => `${r.installed ? "[OK]" : "[FAIL]"} ${r.tool}: ${r.action}`),
    ]

    return {
      title: `Tools: ${installed}/${results.length} ready`,
      output: output.join("\n"),
      metadata: { installed, failed, results },
    }
  },
})
