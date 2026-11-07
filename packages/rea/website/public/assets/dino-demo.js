import { advanceSpeed, simulateSpeed, SPEED_RULE } from "./dino-speed.js";
import { t } from "./i18n.js";

// A new teaching game around the recovered speed rule. Drawing, jump physics
// and rectangle collision checks are authored for this demo.
function initializeDinoDemo(demo) {
  const canvas = demo.querySelector("canvas");
  const context = canvas.getContext("2d");
  if (context === null) return;
  const start = demo.querySelector("[data-dino-start]");
  const slider = demo.querySelector("[data-dino-slider]");
  const auto = demo.querySelector("[data-dino-auto]");
  const output = demo.querySelector("[data-dino-speed]");
  const status = demo.querySelector("[data-dino-status]");
  const ground = 148;
  const dinosaurX = 52;
  const dinosaur = new Path2D(
    "M16 18V2H48V24H35V32H25V43H16V53H8V32H0V23H6V29H16Z M12 47V59H5V54H8V47Z M24 42V54H31V59H20V47Z M34 29H44V35H39V32H34Z",
  );
  let speed = SPEED_RULE.start;
  let height = 0;
  let velocity = 0;
  let distance = 0;
  let obstacles = [];
  let running = false;
  let crashed = false;
  let frame = 0;
  let lastTime = 0;
  let elapsed = 0;

  const updateSpeedDisplay = () => {
    output.value = speed.toFixed(1);
    slider.value = speed.toFixed(1);
  };

  const color = (name, fallback) =>
    getComputedStyle(canvas).getPropertyValue(name).trim() || fallback;

  const draw = () => {
    const ink = color("--dino-ink", "#5b6570");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = color("--dino-ground", "#b7c0c9");
    context.beginPath();
    context.moveTo(0, ground);
    context.lineTo(canvas.width, ground);
    for (let x = -(distance % 70); x < canvas.width; x += 70) {
      context.moveTo(x, ground + 7);
      context.lineTo(x + 12, ground + 7);
    }
    context.stroke();
    context.fillStyle = ink;
    for (const obstacle of obstacles) {
      context.fillRect(
        obstacle.x + 6,
        ground - obstacle.height,
        8,
        obstacle.height,
      );
      context.fillRect(obstacle.x, ground - obstacle.height + 12, 6, 7);
      context.fillRect(obstacle.x, ground - obstacle.height + 3, 5, 15);
      context.fillRect(obstacle.x + 14, ground - obstacle.height + 19, 7, 6);
      context.fillRect(obstacle.x + 17, ground - obstacle.height + 8, 4, 17);
    }
    context.save();
    context.translate(dinosaurX, ground - 59 - height);
    context.fillStyle = crashed
      ? color("--dino-crash", "#8c4b40")
      : color("--dino-player", "#294f82");
    context.fill(dinosaur);
    context.fillStyle = color("--dino-eye", "#ffffff");
    context.fillRect(39, 7, 4, 4);
    context.restore();
    context.fillStyle = ink;
    context.font = "13px monospace";
    context.textAlign = "right";
    context.fillText(
      t("Distance {distance}", {
        distance: String(Math.floor(distance / 100)).padStart(4, "0"),
      }),
      580,
      28,
    );
    if (!running) {
      context.textAlign = "center";
      context.font = "15px system-ui";
      context.fillText(
        crashed ? t("Hit a cactus. Try another speed.") : t("Space or Jump ↑"),
        330,
        85,
      );
    }
  };

  const stop = (message) => {
    running = false;
    cancelAnimationFrame(frame);
    start.textContent = crashed ? t("Play again") : t("Play");
    if (message) status.textContent = message;
    draw();
  };

  const reset = () => {
    stop();
    crashed = false;
    height = 0;
    velocity = 0;
    distance = 0;
    obstacles = [{ x: 550, height: 38 }];
    if (auto.checked) speed = SPEED_RULE.start;
    elapsed = 0;
    start.textContent = t("Play");
    status.textContent = t("Press Play, then jump over the cactus.");
    updateSpeedDisplay();
    draw();
  };

  const update = () => {
    if (auto.checked) speed = advanceSpeed(speed);
    distance += speed;
    if (height > 0 || velocity > 0) {
      height = Math.max(0, height + velocity);
      velocity -= 0.55;
      if (height === 0) velocity = 0;
    }
    obstacles.forEach((obstacle) => {
      obstacle.x -= speed;
    });
    obstacles = obstacles.filter((obstacle) => obstacle.x > -25);
    const last = obstacles[obstacles.length - 1];
    const gap = 400 + speed * 18;
    if (last === undefined || last.x < 600 - gap) {
      obstacles.push({ x: 600, height: 38 });
    }
    const left = dinosaurX + 8;
    const right = dinosaurX + 39;
    const bottom = ground - height;
    if (
      obstacles.some(
        (obstacle) =>
          right > obstacle.x &&
          left < obstacle.x + 21 &&
          bottom > ground - obstacle.height + 4,
      )
    ) {
      crashed = true;
      stop(
        t("Hit a cactus. Press Play again, or change the speed and restart."),
      );
    }
  };

  const animate = (time) => {
    if (!running) return;
    elapsed += Math.min(time - lastTime, 100);
    lastTime = time;
    while (elapsed >= 1000 / 60 && running) {
      elapsed -= 1000 / 60;
      update();
    }
    updateSpeedDisplay();
    draw();
    if (running) frame = requestAnimationFrame(animate);
  };

  const play = () => {
    if (crashed) reset();
    if (running) return;
    running = true;
    lastTime = performance.now();
    elapsed = 0;
    start.textContent = t("Pause");
    status.textContent = t("Running. Space or Jump clears a cactus.");
    frame = requestAnimationFrame(animate);
  };

  const jump = () => {
    if (crashed) reset();
    play();
    if (height === 0) velocity = 10.5;
  };

  start.addEventListener("click", () => {
    if (running) stop(t("Paused. Press Play to continue."));
    else play();
  });
  demo.querySelector("[data-dino-jump]").addEventListener("click", jump);
  demo.querySelector("[data-dino-reset]").addEventListener("click", reset);
  canvas.addEventListener("keydown", (event) => {
    if (event.code === "Space" || event.code === "ArrowUp") {
      event.preventDefault();
      if (!event.repeat) jump();
    }
  });
  canvas.addEventListener("pointerdown", () => {
    canvas.focus();
    jump();
  });
  slider.addEventListener("input", () => {
    auto.checked = false;
    speed = Number(slider.value);
    updateSpeedDisplay();
    status.textContent = running
      ? t("Fixed speed: {speed}. Space or Jump clears a cactus.", {
          speed: speed.toFixed(1),
        })
      : t("Fixed speed: {speed}. Press Play to try it.", {
          speed: speed.toFixed(1),
        });
    draw();
  });
  auto.addEventListener("change", () => {
    if (auto.checked) speed = SPEED_RULE.start;
    updateSpeedDisplay();
    status.textContent = auto.checked
      ? t("Recovered rule: start at 6, then increase toward 13.")
      : t("Fixed speed: {speed}.", { speed: speed.toFixed(1) });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && running) stop(t("Paused. Press Play to continue."));
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting && running)
        stop(t("Paused. Press Play to continue."));
    }).observe(demo);
  }
  window.addEventListener("website-theme-change", draw);
  demo.querySelector(".dino-fallback").setAttribute("hidden", "");
  demo.querySelector(".dino-controls").hidden = false;
  canvas.hidden = false;
  reset();
}

document.querySelectorAll("[data-dino-demo]").forEach(initializeDinoDemo);

const speedCheck = document.querySelector("[data-speed-check]");
if (speedCheck !== null) speedCheck.hidden = false;
speedCheck?.addEventListener("click", () => {
  let matches = true;
  document.querySelectorAll("[data-speed-updates]").forEach((cell) => {
    const speed = simulateSpeed(
      Number(cell.getAttribute("data-speed-updates")),
    ).toFixed(3);
    cell.textContent = speed;
    matches =
      matches && speed === cell.parentElement.children[1].textContent.trim();
  });
  document.querySelector("[data-speed-check-status]").textContent = matches
    ? t(
        "Replayed the recovered rule. All four values match the controlled original-game check when rounded to three decimals.",
      )
    : t(
        "The replay differs from the recorded original-game values. Compare the speed rule and settings above.",
      );
});
