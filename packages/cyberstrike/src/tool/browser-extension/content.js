// Cyberstrike browser control indicator
(function() {
  // Only run in top frame
  if (window !== window.top) return;

  // Create banner
  const banner = document.createElement('div');
  banner.id = 'cyberstrike-banner';
  banner.innerHTML = `
    <span class="cyberstrike-text">"Cyberstrike" started debugging this browser</span>
    <button class="cyberstrike-btn" id="cyberstrike-cancel">Cancel</button>
  `;

  // Insert banner at document start
  function insertBanner() {
    if (document.body && !document.getElementById('cyberstrike-banner')) {
      document.body.insertBefore(banner, document.body.firstChild);

      // Handle cancel button
      document.getElementById('cyberstrike-cancel').addEventListener('click', function() {
        window.close();
      });
    }
  }

  // Try immediately and on DOM ready
  if (document.body) {
    insertBanner();
  } else {
    document.addEventListener('DOMContentLoaded', insertBanner);
  }

  // Also observe for body creation
  const observer = new MutationObserver(function() {
    if (document.body && !document.getElementById('cyberstrike-banner')) {
      insertBanner();
      observer.disconnect();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
