const byId = (id) => document.getElementById(id);
const currentImage = byId("current-image");
const referenceImage = byId("reference-image");
const lightbox = byId("review-lightbox");
const lightboxImage = byId("lightbox-image");
const lightboxStage = byId("lightbox-stage");
let manifest;
let selectedPage;
let selectedCapture = 0;
let referenceBoard;
let opener;
let zoom = 1;
let fitMode = true;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function renderNavigation() {
  const navigation = byId("page-navigation");
  const query = byId("page-filter").value.trim().toLocaleLowerCase();
  const groups = new Map();
  for (const page of manifest.pages) {
    const searchable = [
      page.name,
      page.group,
      page.description,
      ...page.captures.map((c) => c.title),
    ];
    if (query && !searchable.join(" ").toLocaleLowerCase().includes(query)) continue;
    if (!groups.has(page.group)) {
      const section = element("div", "page-group");
      section.append(element("p", "", page.group));
      groups.set(page.group, section);
    }
    const button = element("button", "page-choice");
    button.type = "button";
    button.dataset.page = page.id;
    button.setAttribute("aria-pressed", String(page.id === selectedPage?.id));
    button.append(
      element("span", "", page.name),
      element("small", "", String(page.captures.length)),
    );
    button.addEventListener("click", () => selectPage(page));
    groups.get(page.group).append(button);
  }
  navigation.replaceChildren(...groups.values());
  byId("no-pages").hidden = groups.size !== 0;
}

function selectPage(page, captureIndex = 0) {
  selectedPage = page;
  byId("page-group").textContent = page.group;
  byId("page-title").textContent = page.name;
  byId("page-description").textContent = page.description;
  byId("development-badge").hidden = !page.developmentOnly;
  byId("page-limit").textContent = page.limit || manifest.provenance;
  for (const button of document.querySelectorAll(".page-choice")) {
    button.setAttribute("aria-pressed", String(button.dataset.page === page.id));
  }
  byId("qa-links").replaceChildren(
    ...page.qa.map((path, index) => {
      const link = element(
        "a",
        "",
        page.qa.length === 1 ? "Scoped QA report" : `Scoped QA report ${index + 1}`,
      );
      link.href = path;
      link.target = "_blank";
      link.rel = "noopener";
      return link;
    }),
  );
  byId("capture-list").replaceChildren(
    ...page.captures.map((capture, index) => {
      const item = element("li");
      const button = element("button", "state-choice");
      button.type = "button";
      button.dataset.capture = String(index);
      button.setAttribute("aria-pressed", "false");
      const thumbnail = element("img");
      thumbnail.src = capture.file;
      thumbnail.alt = "";
      thumbnail.loading = "lazy";
      thumbnail.width = 68;
      thumbnail.height = 48;
      const label = element("span");
      label.append(element("strong", "", capture.title), element("small", "", capture.viewport));
      button.append(thumbnail, label);
      button.addEventListener("click", () => selectCapture(index));
      item.append(button);
      return item;
    }),
  );
  selectCapture(captureIndex);
}

function selectCapture(index) {
  selectedCapture = Math.max(0, Math.min(index, selectedPage.captures.length - 1));
  const capture = selectedPage.captures[selectedCapture];
  const reference = capture.reference || selectedPage.reference;
  referenceBoard = manifest.boards[reference.board];
  const view = manifest.views[reference.view];
  const [x, y, width, height] = view.crop;
  byId("capture-count").textContent =
    `Capture ${selectedCapture + 1} of ${selectedPage.captures.length}`;
  byId("capture-title").textContent = capture.title;
  byId("capture-viewport").textContent = capture.viewport;
  byId("capture-note").textContent = capture.note || "Accepted browser fixture capture.";
  byId("capture-previous").disabled = selectedCapture === 0;
  byId("capture-next").disabled = selectedCapture === selectedPage.captures.length - 1;
  currentImage.src = capture.file;
  currentImage.alt = `${selectedPage.name}: ${capture.title}, captured at ${capture.viewport}.`;
  byId("current-original").href = capture.file;
  referenceImage.src = referenceBoard.file;
  referenceImage.alt = `Foundry ${referenceBoard.title} concept board, focused on its ${view.label.toLowerCase()}.`;
  referenceImage.style.width = `${(1672 / width) * 100}%`;
  referenceImage.style.transform = `translate(${(-x / 1672) * 100}%, ${(-y / 941) * 100}%)`;
  byId("open-reference").style.aspectRatio = `${width} / ${height}`;
  byId("reference-title").textContent = referenceBoard.title;
  byId("reference-view").textContent = `${view.label} · generated concept`;
  byId("reference-note").textContent =
    selectedPage.referenceNote ||
    "Focused view of the selected direction. Open the full board to see the surrounding page family.";
  for (const button of document.querySelectorAll(".state-choice")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.capture) === selectedCapture));
  }
  byId("review-status").textContent = `${selectedPage.name} — ${capture.title}`;
  history.replaceState(null, "", `#${selectedPage.id}/${selectedCapture + 1}`);
}

function updateZoom() {
  if (!lightboxImage.naturalWidth) return;
  if (fitMode) {
    zoom = Math.min(
      1,
      (lightboxStage.clientWidth - 36) / lightboxImage.naturalWidth,
      (lightboxStage.clientHeight - 36) / lightboxImage.naturalHeight,
    );
  }
  zoom = Math.max(0.1, Math.min(3, zoom));
  lightboxImage.style.width = `${Math.round(lightboxImage.naturalWidth * zoom)}px`;
  lightboxImage.style.height = "auto";
  byId("zoom-level").textContent = `${fitMode ? "Fit · " : ""}${Math.round(zoom * 100)}%`;
  byId("zoom-out").disabled = zoom <= 0.1;
  byId("zoom-in").disabled = zoom >= 3;
}

function openImage(kind, title, src, caption) {
  opener = document.activeElement;
  byId("lightbox-kind").textContent = kind;
  byId("lightbox-title").textContent = title;
  byId("lightbox-caption").textContent = caption;
  byId("lightbox-original").href = src;
  lightboxImage.alt = title;
  lightboxImage.style.width = "1px";
  lightboxImage.src = src;
  fitMode = true;
  lightbox.showModal();
  lightboxStage.scrollTo(0, 0);
  if (lightboxImage.complete) updateZoom();
}

function openReference() {
  openImage(
    "Original Foundry concept board",
    referenceBoard.title,
    referenceBoard.file,
    "Generated concept reference. Catalog artwork, labels and counts are illustrative; the implemented UI and scoped QA reports establish current behavior.",
  );
}

byId("page-filter").addEventListener("input", renderNavigation);
byId("capture-previous").addEventListener("click", () => selectCapture(selectedCapture - 1));
byId("capture-next").addEventListener("click", () => selectCapture(selectedCapture + 1));
byId("open-current").addEventListener("click", () => {
  const capture = selectedPage.captures[selectedCapture];
  openImage(
    "Implemented UI · browser fixture",
    `${selectedPage.name} — ${capture.title}`,
    capture.file,
    `${capture.viewport}. ${capture.note || "Accepted capture from the scoped QA report."} Native platform qualification remains separate.`,
  );
});
byId("open-reference").addEventListener("click", openReference);
byId("open-board").addEventListener("click", openReference);
byId("lightbox-close").addEventListener("click", () => lightbox.close());
lightbox.addEventListener("close", () => opener?.focus());
lightboxImage.addEventListener("load", updateZoom);
lightboxImage.addEventListener("error", () => {
  byId("lightbox-caption").textContent =
    "This image could not load. Check the original image link or reload the review.";
});
for (const [id, multiplier] of [
  ["zoom-out", 1 / 1.25],
  ["zoom-in", 1.25],
]) {
  byId(id).addEventListener("click", () => {
    fitMode = false;
    zoom *= multiplier;
    updateZoom();
  });
}
byId("zoom-fit").addEventListener("click", () => {
  fitMode = true;
  updateZoom();
  lightboxStage.scrollTo(0, 0);
});
byId("zoom-original").addEventListener("click", () => {
  fitMode = false;
  zoom = 1;
  updateZoom();
});
window.addEventListener("resize", () => {
  if (lightbox.open && fitMode) updateZoom();
});

try {
  const response = await fetch("review-data.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Capture manifest returned HTTP ${response.status}.`);
  manifest = await response.json();
  const captureCount = manifest.pages.reduce((sum, page) => sum + page.captures.length, 0);
  byId("review-count").textContent =
    `${captureCount} accepted captures · ${manifest.pages.length} pages and flows`;
  renderNavigation();
  const [pageId, requestedCapture] = location.hash.slice(1).split("/");
  const page = manifest.pages.find((entry) => entry.id === pageId) || manifest.pages[0];
  const index = Number.parseInt(requestedCapture, 10) - 1;
  selectPage(page, Number.isFinite(index) ? index : 0);
} catch (error) {
  byId("page-title").textContent = "The review could not load";
  byId("page-description").textContent =
    "Serve this folder over local HTTP, then reload. The reports and original files remain available through the links above.";
  byId("review-status").textContent = error.message;
} finally {
  byId("review-workspace").setAttribute("aria-busy", "false");
}
