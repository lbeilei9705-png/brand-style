(function () {
  const scopes = [...document.querySelectorAll("[data-interactive-scope]")];
  const glowCards = [...document.querySelectorAll(".border-glow-card")];

  function updateGlow(card, clientX, clientY) {
    const rect = card.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const edgeDistance = Math.min(x, y, rect.width - x, rect.height - y);
    const edgeProximity = Math.max(0, Math.min(100, 100 - (edgeDistance / 90) * 100));
    const angle = Math.atan2(y - centerY, x - centerX) * (180 / Math.PI) + 90;

    card.style.setProperty("--edge-proximity", edgeProximity.toFixed(2));
    card.style.setProperty("--cursor-angle", `${angle.toFixed(2)}deg`);
  }

  scopes.forEach((scope) => {
    const cards = [...scope.querySelectorAll("[data-interactive-card]")];

    cards.forEach((card) => {
      card.addEventListener("pointerenter", () => {
        cards.forEach((item) => item.classList.remove("selected"));
        scope.classList.add("has-selection");
        card.classList.add("selected");
      });

      card.addEventListener("pointerleave", () => {
        card.classList.remove("selected");
        scope.classList.remove("has-selection");
      });
    });
  });

  glowCards.forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      updateGlow(card, event.clientX, event.clientY);
    });

    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--edge-proximity", "0");
    });
  });
})();
