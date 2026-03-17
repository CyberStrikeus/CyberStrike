<p align="center">
  <picture>
    <source srcset="assets/social-preview-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="assets/social-preview-light.svg" media="(prefers-color-scheme: light)">
    <img src="assets/social-preview-dark.svg" alt="CyberStrike" width="800">
  </picture>
</p>

<h3 align="center">El primer agente de IA de codigo abierto construido para seguridad ofensiva.</h3>

<p align="center">
  Pentesting autonomo desde tu terminal — reconocimiento, descubrimiento de vulnerabilidades, explotacion e informes.<br>
  Un solo comando. 13+ agentes especializados. 120+ casos de prueba OWASP. Tu red team de IA.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cyberstrike"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike?style=flat-square&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/actions/workflows/publish.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/CyberStrike/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://discord.gg/cyberstrike"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&color=00ff41" /></a>
  <a href="https://github.com/CyberStrikeus/CyberStrike/blob/dev/LICENSE"><img alt="Licencia" src="https://img.shields.io/badge/license-AGPL--3.0-00ff41?style=flat-square" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.el.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a> |
  <a href="README.hi.md">हिन्दी</a>
</p>

---

### Por que CyberStrike?

Las pruebas de seguridad siguen siendo abrumadoramente manuales. Los pentesters hacen malabares con docenas de herramientas, copian y pegan salidas entre terminales y pasan horas en reconocimiento repetitivo antes de tocar la superficie de ataque real. Los cazadores de bug bounty pierden tiempo con el mismo flujo de reconocimiento para cada programa.

**CyberStrike cambia eso.** Es un agente de IA autonomo que entiende la metodologia de seguridad ofensiva — no solo ejecuta herramientas, sino que razona sobre que probar, encadena hallazgos y adapta su enfoque segun lo que descubre. Imaginalo como un miembro incansable de tu red team en tu terminal — sigue OWASP WSTG, sabe cuando pivotar y escribe el informe cuando termina.

```bash
npm i -g cyberstrike@latest && cyberstrike
# "Ejecutar una evaluacion OWASP WSTG completa en https://objetivo.com"
```

Es de codigo abierto, funciona con cualquier proveedor de LLM y todo lo que produce es tuyo.

---

### Que lo hace diferente

<table>
<tr>
<td width="50%">

**Agentes de seguridad especializados, no un chat generico**

CyberStrike incluye 13+ agentes disenados especificamente para dominios de seguridad. Cada agente lleva metodologia especifica del dominio, conocimiento de herramientas y patrones de prueba. El agente de aplicaciones web sigue WSTG. El agente de seguridad en la nube conoce los benchmarks CIS. El agente movil usa Frida y sigue MASTG/MASVS. No adivinan — aplican frameworks probados.

</td>
<td width="50%">

**Autonomo, no solo asistente**

Otras herramientas de IA esperan a que les digas que hacer a continuacion. Los agentes de CyberStrike planifican cadenas de ataque de multiples pasos, ejecutan herramientas, analizan resultados, pivotan cuando encuentran algo interesante y generan informes respaldados por evidencia. Tu defines el objetivo — ellos se encargan de la metodologia.

</td>
</tr>
<tr>
<td width="50%">

**Cualquier LLM, sin dependencia**

15+ proveedores listos para usar: Anthropic, OpenAI, Google, Amazon Bedrock, Azure, Groq, Mistral, OpenRouter — incluso modelos locales a traves de endpoints compatibles con OpenAI. Ejecutalo con Claude, GPT, Gemini o tu propio LLM autoalojado. A medida que los modelos mejoran y se abaratan, CyberStrike mejora con ellos.

</td>
<td width="50%">

**Ejecucion remota de herramientas con Bolt**

Tus herramientas de seguridad no tienen que ejecutarse en tu portatil. Bolt es el servidor de herramientas remoto de CyberStrike — desplegalo en un VPS con tu kit de pentesting, emparejalo con claves Ed25519 y controla todo desde tu terminal local a traves del protocolo MCP. Una sola interfaz, multiples servidores de ataque.

</td>
</tr>
</table>

---

### Agentes

Cambia entre agentes con `Tab`. Cada uno es un especialista.

| Agente | Enfoque | Que hace |
|--------|---------|----------|
| **cyberstrike** | General | Agente principal con acceso completo — reconocimiento, explotacion, informes |
| **web-application** | Web | OWASP Top 10, metodologia WSTG, seguridad de API, pruebas de sesion |
| **mobile-application** | Movil | Android/iOS, Frida/Objection, conformidad MASTG/MASVS |
| **cloud-security** | Nube | AWS, Azure, GCP — configuraciones erroneas de IAM, benchmarks CIS, recursos expuestos |
| **internal-network** | Red | Active Directory, ataques Kerberos, movimiento lateral, pivoteo |

Ademas, **8 testers proxy especializados** que interceptan y manipulan trafico para clases de vulnerabilidades especificas:

`IDOR` · `Authorization Bypass` · `Mass Assignment` · `Injection` · `Authentication` · `Business Logic` · `SSRF` · `File Attacks`

---

### Ecosistema MCP

CyberStrike se conecta a servidores MCP especializados que amplian sus capacidades:

| Servidor | Herramientas | Que anade |
|----------|--------------|-----------|
| [hackbrowser-mcp](https://github.com/badchars/hackbrowser-mcp) | 39 | Pruebas de seguridad basadas en navegador — XSS, CSRF, manipulacion DOM, robo de cookies |
| [cloud-audit-mcp](https://github.com/badchars/cloud-audit-mcp) | 38 | Auditorias de seguridad en la nube — 60+ verificaciones en AWS, Azure, GCP |
| [github-security-mcp](https://github.com/badchars/github-security-mcp) | 39 | Postura de seguridad de GitHub — repo, org, actions, secrets, cadena de suministro |
| [cve-mcp](https://github.com/badchars/cve-mcp) | 23 | Inteligencia CVE — NVD, EPSS, CISA KEV, GitHub Advisory, OSV |
| [osint-mcp](https://github.com/badchars/osint-mcp) | 37 | Reconocimiento OSINT — Shodan, VirusTotal, SecurityTrails, Censys, DNS, WHOIS |

Todos de codigo abierto. Todos instalables con `npx`. Conectalos a CyberStrike o usalos de forma independiente con cualquier cliente MCP.

---

### Instalacion

```bash
# npm / bun / pnpm / yarn
npm i -g cyberstrike@latest

# macOS
brew install CyberStrikeus/tap/cyberstrike

# Windows
scoop install cyberstrike

# curl (Linux/macOS)
curl -fsSL https://cyberstrike.io/install | bash
```

**Aplicacion de escritorio** (macOS, Windows, Linux) — descargala desde la [pagina de versiones](https://github.com/CyberStrikeus/CyberStrike/releases) o:

```bash
brew install --cask cyberstrike-desktop          # macOS
scoop bucket add extras; scoop install extras/cyberstrike-desktop  # Windows
```

---

### Herramientas integradas

Los agentes de CyberStrike tienen acceso directo a 30+ herramientas:

| Categoria | Herramientas |
|-----------|--------------|
| **Ejecucion** | Shell (bash), lectura/escritura/edicion de archivos, listado de directorios |
| **Descubrimiento** | Obtencion web, busqueda web, busqueda de codigo, glob, grep |
| **Seguridad** | Reportes de vulnerabilidades (formato HackerOne), recopilacion de evidencia |
| **Proxy** | Intercepcion HTTP/HTTPS, repeticion de solicitudes, analisis de trafico |
| **Integracion** | Servidores MCP, herramientas remotas Bolt, plugins personalizados |

Ademas, un **SDK de plugins** — crea tus propios agentes y herramientas, registralos en tiempo de ejecucion.

---

### Para quien es?

- **Pentesters** — Automatiza las partes repetitivas. Deja que los agentes se encarguen del reconocimiento y las pruebas iniciales mientras te concentras en las cadenas de ataque creativas que requieren intuicion humana.
- **Cazadores de Bug Bounty** — Reconocimiento mas rapido, mayor cobertura, metodologia consistente entre programas. CyberStrike no se cansa a las 3 de la manana.
- **Equipos de seguridad** — Ejecuta evaluaciones OWASP estructuradas con metodologia reproducible. Obtiene informes que se alinean con estandares que tu equipo de cumplimiento entiende.
- **Investigadores de seguridad** — Amplia CyberStrike con agentes personalizados y servidores MCP. El sistema de plugins y el protocolo MCP lo convierten en una plataforma, no solo en una herramienta.

---

### Contribuir

CyberStrike esta construido por la comunidad de seguridad, para la comunidad de seguridad. Damos la bienvenida a contribuciones en:

- **Agentes y habilidades de seguridad** — Nuevas metodologias de ataque, patrones de prueba, deteccion de vulnerabilidades
- **Servidores MCP** — Conectar nuevas herramientas de seguridad y fuentes de datos
- **Base de conocimientos** — Guias metodologicas WSTG, MASTG, PTES, CIS
- **Mejoras del nucleo** — Rendimiento, experiencia de usuario, integraciones de proveedores, correccion de errores

Lee la [guia de contribucion](./CONTRIBUTING.md) antes de enviar un PR. Todas las contribuciones deben seguir la [politica de uso etico](./CODE_OF_CONDUCT.md) del proyecto — CyberStrike es exclusivamente para pruebas de seguridad autorizadas.

---

### Licencia

[AGPL-3.0-only](./LICENSE) — Gratuito para uso personal y de codigo abierto. Licencia comercial disponible a traves de [contact@cyberstrike.io](mailto:contact@cyberstrike.io).

---

<p align="center">
  <a href="https://discord.gg/cyberstrike"><b>Discord</b></a> · <a href="https://x.com/cyberstrike"><b>X.com</b></a> · <a href="https://cyberstrike.io"><b>cyberstrike.io</b></a>
</p>
<p align="center">
  <sub>Construido por hackers cansados de copiar y pegar entre terminales.</sub>
</p>
