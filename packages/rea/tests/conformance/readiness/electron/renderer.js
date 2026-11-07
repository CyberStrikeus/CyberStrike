async function echoRenderer() {
  document.querySelector("#result").textContent =
    await window.readiness.echo("renderer");
}

document.querySelector("#run").addEventListener("click", () => {
  echoRenderer().catch((cause) => {
    document.querySelector("#result").textContent = "Echo failed";
    console.error("Renderer echo failed", cause);
  });
});
window.readiness.onDeepLink((_event, url) => {
  document.querySelector("#result").textContent = url;
});
