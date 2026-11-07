// This small, blocking head script applies the theme before the first paint.
(() => {
  const root = document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const storageKey = "rea-theme";
  const parseChoice = (value) =>
    value === "light" || value === "dark" ? value : null;
  let choice = null;
  let storage = null;
  try {
    storage = window.localStorage;
    choice = parseChoice(storage.getItem(storageKey));
  } catch {
    // The switch still works when browser storage is unavailable.
  }

  const applyTheme = () => {
    const theme = choice ?? (system.matches ? "dark" : "light");
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content =
      theme === "dark" ? "#1e1e2e" : "#ffffff";
    window.dispatchEvent(new Event("website-theme-change"));
  };

  applyTheme();
  system.addEventListener("change", () => {
    if (choice === null) applyTheme();
  });
  window.addEventListener("storage", (event) => {
    if (
      storage !== null &&
      event.storageArea === storage &&
      (event.key === storageKey || event.key === null)
    ) {
      try {
        // Another tab may have written a newer choice while this event waited.
        choice = parseChoice(storage.getItem(storageKey));
      } catch {
        return;
      }
      applyTheme();
    }
  });

  const initializeToggle = async () => {
    const button = document.querySelector("[data-theme-toggle]");
    if (button === null) return;
    const { t } = await import("./i18n.js");
    const updateLabel = () => {
      const label =
        root.dataset.theme === "dark"
          ? t("Switch to light mode")
          : t("Switch to dark mode");
      button.setAttribute("aria-label", label);
      button.title = label;
    };
    window.addEventListener("website-theme-change", updateLabel);
    button.addEventListener("click", () => {
      choice = root.dataset.theme === "dark" ? "light" : "dark";
      try {
        storage?.setItem(storageKey, choice);
      } catch {
        // Retain the choice for this page even if it cannot be saved.
      }
      applyTheme();
    });
    updateLabel();
    button.hidden = false;
  };
  document.addEventListener("DOMContentLoaded", () => {
    initializeToggle().catch((cause) => {
      console.error("Theme toggle initialization failed", cause);
    });
  });
})();
