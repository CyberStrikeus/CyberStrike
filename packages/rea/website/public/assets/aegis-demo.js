import { generateExampleCode } from "./aegis-otp.js";
import { t } from "./i18n.js";

async function initializeAegisDemo() {
  const demo = document.querySelector("[data-aegis-demo]");
  if (demo === null) return;
  const clock = demo.querySelector("input[type=range]");
  const controls = demo.querySelectorAll("input, button");
  const status = demo.querySelector("[data-aegis-status]");
  let revision = 0;

  const updateTime = async (seconds) => {
    const currentRevision = ++revision;
    try {
      const code = await generateExampleCode(seconds);
      if (currentRevision !== revision) return false;
      const block = Math.floor(seconds / 30);
      demo.querySelector("[data-aegis-seconds]").textContent = String(seconds);
      demo.querySelector("[data-aegis-block]").textContent = String(block);
      demo.querySelector("[data-aegis-division]").textContent =
        `floor(${seconds} / 30)`;
      demo.querySelector("[data-aegis-window]").textContent = t(
        "{start}–{end} seconds",
        { start: block * 30, end: block * 30 + 29 },
      );
      demo.querySelector("[data-aegis-code]").textContent = code;
      clock.setAttribute(
        "aria-valuetext",
        t("{seconds} seconds, time block {block}", { seconds, block }),
      );
      status.textContent = "";
      return true;
    } catch {
      if (currentRevision === revision) {
        status.textContent = t(
          "Interactive calculation is unavailable in this browser. The example shows the code at 59 seconds.",
        );
      }
      return false;
    }
  };

  if (!(await updateTime(Number(clock.value)))) return;
  controls.forEach((control) => {
    control.disabled = false;
  });
  clock.addEventListener("input", async () => {
    await updateTime(Number(clock.value));
  });
  demo.querySelectorAll("[data-aegis-time]").forEach((button) => {
    button.addEventListener("click", async () => {
      clock.value = button.getAttribute("data-aegis-time");
      await updateTime(Number(clock.value));
    });
  });

  const checkButton = document.querySelector("[data-aegis-check]");
  const checkResult = document.querySelector("[data-aegis-check-result]");
  checkButton.disabled = false;
  checkButton.addEventListener("click", async () => {
    checkButton.disabled = true;
    checkResult.textContent = t("Checking…");
    try {
      const response = await fetch(
        new URL("../showcase/aegis/test-vectors.json", import.meta.url),
      );
      if (!response.ok) throw new Error("Reference data unavailable");
      const { vectors } = await response.json();
      let passed = 0;
      for (const vector of vectors) {
        for (const digits of [6, 8]) {
          const code = await generateExampleCode(vector.seconds, digits);
          if (code === vector.sha1.slice(-digits)) passed += 1;
        }
      }
      checkResult.textContent = t(
        "{passed} / {total} checks passed (six reference cases, at six and eight digits).",
        { passed, total: vectors.length * 2 },
      );
    } catch {
      checkResult.textContent = t(
        "Could not run the reference checks. Try again.",
      );
    } finally {
      checkButton.disabled = false;
    }
  });
}

await initializeAegisDemo();
