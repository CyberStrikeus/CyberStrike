import { t } from "./i18n.js";

function initializePercentDemo() {
  const demo = document.querySelector("[data-percent-demo]");
  if (demo === null) return;
  const display = demo.querySelector("[data-percent-display]");
  const expression = demo.querySelector("[data-percent-expression]");
  const status = demo.querySelector("[data-percent-status]");
  const equals = demo.querySelector('[data-percent-key="equals"]');
  const operations = demo.querySelectorAll("[data-percent-operation]");
  let operation = "add";
  let stage = "input";

  const render = () => {
    const adding = operation === "add";
    const previous = 200;
    const current = 10;
    const percent = adding ? (current * previous) / 100 : current / 100;
    const result = adding ? previous + percent : previous * percent;
    const operator = adding ? "+" : "×";
    expression.textContent =
      stage === "result" ? `200 ${operator} ${percent} =` : `200 ${operator}`;
    display.textContent = String(
      stage === "input" ? current : stage === "percent" ? percent : result,
    );
    equals.disabled = stage !== "percent";
    status.textContent =
      stage === "input"
        ? t("Press % to see what happens to 10.")
        : stage === "percent"
          ? adding
            ? t("10% of 200 is 20. Press = to add it.")
            : t("For multiplication, 10 becomes 0.1. Press = to multiply.")
          : `200 ${operator} ${percent} = ${result}.`;
  };

  operations.forEach((button) => {
    button.addEventListener("click", () => {
      operation = button.getAttribute("data-percent-operation");
      stage = "input";
      operations.forEach((candidate) => {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      });
      render();
    });
  });
  demo.querySelectorAll("[data-percent-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.getAttribute("data-percent-key");
      stage =
        key === "reset" ? "input" : key === "percent" ? "percent" : "result";
      render();
    });
  });
  demo.querySelector(".percent-operation").hidden = false;
  demo.querySelector(".percent-controls").hidden = false;
  render();
}

function initializeHomeNavigation() {
  const menu = document.querySelector("[data-home-nav]");
  if (menu === null) return;
  const currentLabel = menu.querySelector("[data-home-nav-current]");
  if (currentLabel === null) return;
  const entries = Array.from(menu.querySelectorAll('a[href^="#"]'))
    .map((link) => ({
      link,
      target: document.getElementById(link.getAttribute("href").slice(1)),
    }))
    .filter((entry) => entry.target !== null);
  if (entries.length === 0) return;

  // CSS decides when there is room for a sidebar.
  let sidebarLayout = window.getComputedStyle(menu).position === "fixed";
  menu.open = sidebarLayout;

  const updatePosition = () => {
    const offset = sidebarLayout ? 40 : 88;
    let current = entries[0];
    entries.forEach((entry) => {
      if (entry.target.getBoundingClientRect().top <= offset) current = entry;
    });
    if (
      window.scrollY + window.innerHeight >=
      document.documentElement.scrollHeight - 2
    ) {
      const selected = entries.find(
        (entry) => entry.link.hash === window.location.hash,
      );
      const selectedTop = selected?.target.getBoundingClientRect().top;
      current =
        selectedTop !== undefined &&
        selectedTop >= 0 &&
        selectedTop < window.innerHeight
          ? selected
          : entries[entries.length - 1];
    }
    entries.forEach((entry) => {
      if (entry === current)
        entry.link.setAttribute("aria-current", "location");
      else entry.link.removeAttribute("aria-current");
    });
    currentLabel.textContent = current.link.textContent;
  };
  const updateLayout = () => {
    const nextSidebarLayout =
      window.getComputedStyle(menu).position === "fixed";
    if (nextSidebarLayout !== sidebarLayout) {
      sidebarLayout = nextSidebarLayout;
      menu.open = sidebarLayout;
    }
    updatePosition();
  };
  let scheduled = false;
  const schedulePosition = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      updateLayout();
    });
  };
  entries.forEach(({ link, target }) => {
    link.addEventListener("click", () => {
      if (!sidebarLayout) menu.open = false;
      const heading = target.querySelector("h2") ?? target;
      heading.setAttribute("tabindex", "-1");
      window.requestAnimationFrame(() =>
        heading.focus({ preventScroll: true }),
      );
    });
  });
  window.addEventListener("scroll", schedulePosition, { passive: true });
  window.addEventListener("resize", schedulePosition, { passive: true });
  window.addEventListener("hashchange", schedulePosition);
  window.addEventListener("load", schedulePosition);
  updateLayout();
}

initializePercentDemo();
initializeHomeNavigation();
