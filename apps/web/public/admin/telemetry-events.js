import { exportDiagnostics, loadTelemetry, showTelemetryEvent, telemetryState } from "./telemetry.js";

function toggleCustomRange() {
  const custom = document.querySelector("#telemetry-range").value === "custom";
  for (const field of document.querySelectorAll(".telemetry-custom-time")) {
    field.hidden = !custom;
  }
}

export function bindTelemetryEvents() {
  document.querySelector("#telemetry-filter-form").addEventListener("submit", (event) => {
    event.preventDefault();
    loadTelemetry();
  });
  document.querySelector("#telemetry-range").addEventListener("change", toggleCustomRange);
  document.querySelector("#refresh-telemetry-button").addEventListener("click", loadTelemetry);
  document.querySelector("#export-diagnostics-button").addEventListener("click", exportDiagnostics);
  toggleCustomRange();
}

export function handleTelemetryClick(target) {
  if (target.dataset.page === "telemetry-page" && !telemetryState.loaded) {
    loadTelemetry();
  }
  if (target.dataset.action === "view-telemetry-event") {
    showTelemetryEvent(Number(target.dataset.index));
  }
}
