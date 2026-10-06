const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

const toast = (message) => {
  const el = $("#toast");
  $("span", el).textContent = message;
  el.classList.add("show");
  window.clearTimeout(window.__toastTimer);
  window.__toastTimer = window.setTimeout(() => el.classList.remove("show"), 2600);
};

function showView(view) {
  $$("[data-panel]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.panel !== view));
  $$(".nav-item[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
  refreshIcons();
}

function openImportModal() { $("#modalBackdrop").classList.add("open"); }
function closeImportModal() { $("#modalBackdrop").classList.remove("open"); }

$$('.nav-item[data-view]').forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));

$("#importButton").addEventListener("click", openImportModal);
$("#modalClose").addEventListener("click", closeImportModal);
$("#modalBackdrop").addEventListener("click", (event) => { if (event.target.id === "modalBackdrop") closeImportModal(); });
$("#qualityButton").addEventListener("click", () => toast("质量报告已打开：98.2 / 100"));
$("#viewAllButton").addEventListener("click", () => showView("evidence"));
$("#createWorkOrder").addEventListener("click", () => { showView("workorders"); toast("已创建维修工单 WO-20260905-018"); });
$("#markReview").addEventListener("click", () => toast("已标记为人工复核"));
$("#createWorkOrder2").addEventListener("click", () => toast("新工单草稿已创建"));
$("#newMissionButton").addEventListener("click", () => toast("新建任务向导已准备就绪"));
$("#newMissionButton2").addEventListener("click", () => toast("新建任务向导已准备就绪"));

$$('.anomaly-item').forEach((item) => item.addEventListener("click", () => {
  $$('.anomaly-item').forEach((other) => other.classList.remove("active"));
  item.classList.add("active");
  const eventName = item.dataset.event;
  const pin = $(`.pin[data-event="${eventName}"]`);
  if (pin) {
    pin.animate([{ transform: "scale(1)" }, { transform: "scale(1.5)" }, { transform: "scale(1)" }], { duration: 520 });
  }
  toast(`${$("strong", item).textContent} 已聚焦到地图`);
}));

$$('.pin[data-event]').forEach((pin) => pin.addEventListener("click", () => {
  const item = $(`.anomaly-item[data-event="${pin.dataset.event}"]`);
  if (item) item.click();
}));

$("#dropzone").addEventListener("dragover", (event) => { event.preventDefault(); $("#dropzone").style.borderColor = "#4ba782"; });
$("#dropzone").addEventListener("dragleave", () => { $("#dropzone").style.borderColor = ""; });
$("#dropzone").addEventListener("drop", (event) => { event.preventDefault(); handleFiles(event.dataTransfer.files); });
$("#fileInput").addEventListener("change", (event) => handleFiles(event.target.files));

function handleFiles(files) {
  const count = files.length;
  if (!count) return;
  closeImportModal();
  toast(`已接收 ${count} 个文件，等待质量检查`);
  window.setTimeout(() => toast("演示分析完成：发现 3 个待复核事件"), 1250);
}

$$('.filter-tabs button').forEach((button) => button.addEventListener("click", () => {
  $$('.filter-tabs button').forEach((other) => other.classList.remove("active"));
  button.classList.add("active");
}));

refreshIcons();
