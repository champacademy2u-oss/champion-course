(() => {
  "use strict";
  const list = document.getElementById("previewLeadListPanel");
  const analysis = document.getElementById("previewVisitorStagePanel");
  const listButton = document.getElementById("previewLeadListButton");
  const visitorButton = document.getElementById("previewVisitorStageButton");
  if (!list || !analysis || !listButton || !visitorButton) return;
  function select(visitor) {
    list.hidden = visitor;
    analysis.hidden = !visitor;
    listButton.setAttribute("aria-pressed", String(!visitor));
    visitorButton.setAttribute("aria-pressed", String(visitor));
  }
  listButton.addEventListener("click", () => select(false));
  visitorButton.addEventListener("click", () => select(true));
})();
