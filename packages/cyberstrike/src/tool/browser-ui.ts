// HackR Browser Control Page
// Opens as the first tab when browser launches
// Multi-context aware with color-coded context indicator

export function generateControlPage(contexts: Array<{ id: string; label: string; color: string }>): string {
  const contextList = contexts
    .map((c) => `<span class="ctx-badge" style="border-color: ${c.color}; color: ${c.color}">${c.label}</span>`)
    .join("")

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HackR Browser</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      background: #0f172a;
      display: flex; align-items: center; justify-content: center;
      color: #f8fafc; position: relative; overflow: hidden;
    }
    .glow {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 800px; height: 400px;
      background: radial-gradient(ellipse at center, rgba(220, 38, 38, 0.3) 0%, transparent 70%);
      pointer-events: none;
    }
    .container {
      position: relative; z-index: 1; text-align: center;
      padding: 40px; display: flex; flex-direction: column;
      align-items: center; justify-content: center;
    }
    .logo-text {
      font-size: 48px; font-weight: 700; color: #f8fafc;
      letter-spacing: -1px; margin-bottom: 8px;
    }
    .logo-sub {
      font-size: 16px; color: #94a3b8; margin-bottom: 32px;
    }
    .status-badge {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 12px 24px;
      background: rgba(220, 38, 38, 0.2);
      border: 1px solid rgba(220, 38, 38, 0.4);
      border-radius: 9999px; font-size: 15px;
    }
    .status-dot {
      width: 10px; height: 10px; background: #dc2626;
      border-radius: 50%; box-shadow: 0 0 12px #dc2626;
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.9); }
    }
    .status-text { color: #dc2626; font-weight: 600; }
    .info-grid {
      display: flex; gap: 16px; margin-top: 48px;
      flex-wrap: wrap; justify-content: center;
    }
    .info-card {
      display: flex; align-items: center; gap: 12px;
      padding: 16px 24px;
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(71, 85, 105, 0.4);
      border-radius: 12px; font-size: 14px; color: #94a3b8;
      transition: all 0.2s;
    }
    .info-card:hover {
      border-color: #dc2626; background: rgba(220, 38, 38, 0.1); color: #e2e8f0;
    }
    .info-card svg { width: 22px; height: 22px; color: #dc2626; }
    .contexts {
      display: flex; gap: 12px; margin-top: 32px; flex-wrap: wrap; justify-content: center;
    }
    .ctx-badge {
      padding: 8px 16px; border: 2px solid;
      border-radius: 8px; font-size: 13px; font-weight: 600;
      background: rgba(30, 41, 59, 0.5);
    }
    .divider {
      width: 180px; height: 1px;
      background: rgba(71, 85, 105, 0.4); margin: 48px auto;
    }
    .footer-text {
      font-size: 13px; color: #64748b;
      max-width: 500px; line-height: 1.8;
    }
    .footer-text strong { color: #94a3b8; }
  </style>
</head>
<body>
  <div class="glow"></div>
  <div class="container">
    <div class="logo-text">HackR</div>
    <div class="logo-sub">CyberStrike Browser</div>

    <div class="status-badge">
      <div class="status-dot"></div>
      <span class="status-text">Capturing Traffic</span>
    </div>

    <div class="contexts" id="context-list">${contextList}</div>

    <div class="info-grid">
      <div class="info-card">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        Multi-Context Isolation
      </div>
      <div class="info-card">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
        Network Capture Active
      </div>
      <div class="info-card">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        IDOR Detection
      </div>
    </div>

    <div class="divider"></div>

    <p class="footer-text">
      This browser is controlled by <strong>CyberStrike HackR</strong>.<br>
      Each context has isolated cookies, sessions, and localStorage.<br>
      Full analysis pipeline runs on browser close.
    </p>
  </div>

  <script>
    console.log('%c HackR Browser Session', 'color: #dc2626; font-size: 20px; font-weight: bold;');
    console.log('%c   Multi-context: ACTIVE', 'color: #64748b;');
    console.log('%c   Network capture: ACTIVE', 'color: #64748b;');
    console.log('%c   Analysis pipeline: READY', 'color: #64748b;');
  </script>
</body>
</html>
`
}

/**
 * Generate injection script for a specific context
 * Adds colored banner + border to indicate which context is active
 */
export function generateContextInjection(contextId: string, label: string, color: string): string {
  return `
(function() {
  if (document.title === 'HackR Browser' || window.__hackr_injected) return;
  window.__hackr_injected = true;

  const style = document.createElement('style');
  style.textContent = \`
    html {
      border: 3px solid ${color} !important;
      box-sizing: border-box !important;
    }
    #hackr-banner {
      position: fixed !important;
      top: 0 !important; left: 0 !important; right: 0 !important;
      z-index: 2147483647 !important;
      background: linear-gradient(to bottom, rgba(15,23,42,0.95), rgba(15,23,42,0.9)) !important;
      border-bottom: 2px solid ${color} !important;
      padding: 6px 16px !important;
      display: flex !important; align-items: center !important; gap: 12px !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 12px !important; color: #e2e8f0 !important;
    }
    #hackr-banner .ctx-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: ${color}; box-shadow: 0 0 8px ${color};
    }
    #hackr-banner .ctx-label {
      color: ${color}; font-weight: 600;
    }
    body { margin-top: 32px !important; }
  \`;

  const banner = document.createElement('div');
  banner.id = 'hackr-banner';
  banner.innerHTML = '<span class="ctx-dot"></span><span class="ctx-label">${label}</span><span style="color:#64748b">|</span><span style="color:#64748b">HackR — ${contextId}</span>';

  function insert() {
    if (!document.getElementById('hackr-banner')) {
      document.head?.appendChild(style);
      document.body?.insertBefore(banner, document.body.firstChild);
    }
  }

  if (document.body) insert();
  else document.addEventListener('DOMContentLoaded', insert);
})();
`
}
