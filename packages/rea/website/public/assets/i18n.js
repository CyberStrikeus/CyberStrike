const messages = JSON.parse(
  document.getElementById("website-messages")?.textContent ?? "{}",
);

export function t(message, values = {}) {
  const translated = messages[message] ?? message;
  return translated.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}

document.querySelectorAll("[data-language]").forEach((link) => {
  link.addEventListener("click", () => {
    const target = new URL(link.href);
    target.hash = window.location.hash;
    link.href = target.href;
  });
});

const picker = document.querySelector(".language-picker");
if (picker !== null) {
  document.addEventListener("click", (event) => {
    if (!picker.contains(event.target)) picker.open = false;
  });
  picker.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      picker.open = false;
      picker.querySelector("summary").focus();
    }
  });
}
