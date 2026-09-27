const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
};
const byId = (id) => document.getElementById(id);
const pad = (value) => String(value).padStart(2, "0");
const baseUrl = new URL(".", window.location.href);
const localResource = (path) => {
  if (typeof path !== "string" || !path.trim()) return null;
  const url = new URL(path.replaceAll("\\", "/"), baseUrl);
  if (url.origin !== baseUrl.origin || !url.pathname.startsWith(baseUrl.pathname)) return null;
  if (!/^https?:$/.test(url.protocol)) return null;
  return url.href;
};
const jsonResource = async (path) => {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`);
  return response.json();
};
const titleCase = (name) =>
  String(name || "Screenshot")
    .replaceAll("-", " ")
    .replace(/\b(?:hud|cfg|tf2)\b/gi, (word) => word.toUpperCase())
    .replace(/^\w/, (word) => word.toUpperCase());
let selectedOptionId = null;
let optionRequest = 0;
let loadedOptions = [];

function getPalette(palette) {
  const values = Array.isArray(palette)
    ? palette
    : palette && typeof palette === "object"
      ? Object.entries(palette).map(([name, color]) => ({ name, color }))
      : [];
  return values
    .map((value) =>
      typeof value === "string"
        ? { color: value, name: value }
        : {
            color: value?.color || value?.value || value?.hex,
            name: value?.name || value?.label || value?.color,
          },
    )
    .filter((value) => typeof value.color === "string" && /^#[\da-f]{3,8}$/i.test(value.color))
    .slice(0, 5);
}

function applySamplePalette(option) {
  const colors = getPalette(option.palette).map((item) => item.color);
  if (colors.length < 4) return;
  const tokens = {
    background: colors[0],
    surface: colors[1],
    ink: colors[2],
    accent: colors.at(-1),
  };
  Object.entries(tokens).forEach(([name, value]) => {
    document.documentElement.style.setProperty(`--sample-${name}`, value);
  });
  byId("sample-palette-label").textContent = `${option.name} palette · timings stay the same`;
}

function openOriginalLink(url, label = "Open original ↗") {
  const link = element("a", "text-link", label);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  return link;
}

function viewInfo(view) {
  const text = typeof view === "string" ? view : view?.title || view?.name || view?.label || "View";
  const status = typeof view === "object" && view ? view.status : "";
  const label = String(text)
    .replace(/\s*(?:[—–:]\s*)?[([]?(?:planned|dev(?:elopment)?[ -]?only)[)\]]?\s*$/gi, "")
    .trim();
  const source = `${text} ${status}`;
  const badge = /dev(?:elopment)?[ -]?only|inventory/i.test(source)
    ? "Dev only"
    : /planned|app settings|profile deletion/i.test(source)
      ? "Planned"
      : "";
  return { label, badge };
}

function buildBoard(board, option, index, panelId) {
  const title = String(board.title || `Board ${index + 1}`);
  const views = Array.isArray(board.views) ? board.views : [];
  const viewText = views.map((view) => viewInfo(view).label).join(", ");
  const note = typeof board.note === "string" ? board.note : "";
  const url = localResource(board.file);
  const figure = element("figure", "concept-board");
  figure.id = `${panelId}-board-${index + 1}`;
  const header = element("div", "board-header");
  const heading = element("div", "board-title");
  heading.append(element("span", "", pad(index + 1)), element("h3", "", title));
  header.append(heading);
  if (url) header.append(openOriginalLink(url));
  figure.append(header);

  const shell = element("div", "board-image-shell");
  const button = element("button", "board-image-button");
  button.type = "button";
  button.setAttribute("aria-label", `Inspect ${option.name}: ${title}`);
  const image = element("img");
  image.alt = `${option.name} concept board: ${viewText || title}`;
  image.width = 1600;
  image.height = 900;
  image.loading = index === 0 ? "eager" : "lazy";
  image.decoding = "async";
  const placeholder = element("div", "board-unavailable");
  placeholder.append(
    element("strong", "", "Board image not available"),
    element(
      "p",
      "",
      "This concept file has not loaded yet. Reload the boards after it has been added.",
    ),
  );
  const retry = element("button", "button subtle", "Retry image ↻");
  retry.type = "button";
  if (url) placeholder.append(retry);
  placeholder.hidden = true;
  const attemptImage = () => {
    if (!url) {
      button.hidden = true;
      placeholder.hidden = false;
      return;
    }
    const fresh = new URL(url);
    fresh.searchParams.set("review", Date.now().toString());
    button.hidden = false;
    placeholder.hidden = true;
    image.src = fresh.href;
  };
  image.addEventListener("load", () => {
    button.hidden = false;
    placeholder.hidden = true;
  });
  image.addEventListener("error", () => {
    button.hidden = true;
    placeholder.hidden = false;
  });
  retry.addEventListener("click", attemptImage);
  button.addEventListener("click", () => {
    if (url && image.naturalWidth)
      openImage({
        url,
        title: `${option.name} — ${title}`,
        kind: "Image-generated concept",
        caption: [viewText, note].filter(Boolean).join(". "),
        alt: image.alt,
      });
  });
  button.append(image);
  shell.append(button, placeholder);
  figure.append(shell);
  const caption = element("figcaption");
  if (views.length) {
    const list = element("ol", "board-views");
    views.forEach((view, viewIndex) => {
      const { label, badge } = viewInfo(view);
      const item = element("li");
      const viewLabel = element("span", "view-label");
      viewLabel.append(element("span", "", label));
      if (badge) viewLabel.append(element("span", "state-badge", badge));
      item.append(element("span", "view-position", pad(viewIndex + 1)), viewLabel);
      list.append(item);
    });
    caption.append(list);
  }
  if (note) caption.append(element("p", "board-note", note));
  if (/workspaces/i.test(title) || /03-workspaces/i.test(String(board.file || ""))) {
    caption.append(
      element(
        "p",
        "board-data-note",
        "Generated catalog artwork, names and counts are illustrative, not product data.",
      ),
    );
  }
  figure.append(caption);
  attemptImage();
  return figure;
}

function activateOption(id, moveFocus = false) {
  selectedOptionId = id;
  const option = loadedOptions.find((item) => String(item.id) === id);
  if (option) applySamplePalette(option);
  const tabs = [...byId("option-tabs").querySelectorAll('[role="tab"]')];
  tabs.forEach((tab) => {
    const selected = tab.dataset.optionId === id;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    byId(tab.getAttribute("aria-controls")).hidden = !selected;
    if (selected && moveFocus) tab.focus();
  });
}

async function loadOptions() {
  const request = ++optionRequest;
  const status = byId("option-status");
  const tabs = byId("option-tabs");
  const panels = byId("option-panels");
  const reload = byId("reload-options");
  reload.disabled = true;
  tabs.setAttribute("aria-busy", "true");
  status.classList.remove("error");
  status.textContent = "Loading the direction manifest…";
  try {
    const manifest = await jsonResource("options/manifest.json");
    if (request !== optionRequest) return;
    if (!Array.isArray(manifest.options) || !manifest.options.length)
      throw new Error("The direction manifest has no options yet.");
    tabs.replaceChildren();
    panels.replaceChildren();
    const options = manifest.options.filter((option) => option && typeof option === "object");
    loadedOptions = options;
    options.forEach((option, index) => {
      const id = String(option.id || `option-${index + 1}`);
      const name = String(option.name || `Direction ${index + 1}`);
      const description = String(option.description || "");
      const boards = Array.isArray(option.boards) ? option.boards : [];
      const panelId = `option-panel-${index + 1}`;
      const tab = element("button", "option-tab");
      tab.type = "button";
      tab.id = `option-tab-${index + 1}`;
      tab.dataset.optionId = id;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", panelId);
      tab.setAttribute("aria-selected", "false");
      tab.tabIndex = -1;
      const top = element("span", "option-tab-top");
      top.append(
        element("span", "option-index", pad(index + 1)),
        element("span", "option-name", name),
      );
      const palette = getPalette(option.palette);
      if (palette.length) {
        const swatches = element("span", "palette-swatches");
        swatches.setAttribute("aria-hidden", "true");
        palette.forEach((color) => {
          const swatch = element("span", "palette-swatch");
          swatch.style.backgroundColor = color.color;
          swatches.append(swatch);
        });
        top.append(swatches);
      }
      tab.append(
        top,
        element(
          "span",
          "option-tab-description",
          String(option.tagline || description.split(/[.!?]/)[0] || "A complete visual direction"),
        ),
        element("span", "selection-dot"),
      );
      tab.addEventListener("click", () => activateOption(id));
      tab.addEventListener("keydown", (event) => {
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % options.length;
        else if (event.key === "ArrowLeft") next = (index - 1 + options.length) % options.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = options.length - 1;
        else return;
        event.preventDefault();
        activateOption(String(options[next].id || `option-${next + 1}`), true);
      });
      tabs.append(tab);

      const panel = element("div", "option-panel");
      panel.id = panelId;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tab.id);
      panel.hidden = true;
      const overview = element("div", "option-overview");
      const overviewText = element("div");
      if (description) overviewText.append(element("p", "", description));
      const viewCount = boards.reduce(
        (count, board) => count + (Array.isArray(board.views) ? board.views.length : 0),
        0,
      );
      overview.append(
        overviewText,
        element(
          "span",
          "option-count",
          `${boards.length} boards${viewCount ? ` · ${viewCount} views` : ""}`,
        ),
      );
      panel.append(overview);
      if (boards.length) {
        const boardNav = element("nav", "board-nav");
        boardNav.setAttribute("aria-label", `${name} boards`);
        boards.forEach((board, boardIndex) => {
          const link = element("a");
          link.href = `#${panelId}-board-${boardIndex + 1}`;
          link.append(
            element("span", "", pad(boardIndex + 1)),
            document.createTextNode(String(board.title || `Board ${boardIndex + 1}`)),
          );
          boardNav.append(link);
        });
        panel.append(boardNav);
        boards.forEach((board, boardIndex) => {
          panel.append(buildBoard(board, { ...option, name }, boardIndex, panelId));
        });
      } else
        panel.append(
          element("p", "load-status", "Boards will appear when the manifest includes them."),
        );
      panels.append(panel);
    });
    if (!options.length) throw new Error("The direction manifest has no valid options yet.");
    const chosen = options.some((option) => String(option.id) === selectedOptionId)
      ? selectedOptionId
      : String(options[0].id || "option-1");
    activateOption(chosen);
    status.textContent = "";
  } catch (error) {
    if (request !== optionRequest) return;
    status.classList.add("error");
    status.textContent =
      window.location.protocol === "file:"
        ? "Open this review through the local HTTP server so it can read its image manifests. See README.md for the command."
        : `${error.message} The images and metadata may still be in preparation. Use Reload boards to try again.`;
  } finally {
    if (request === optionRequest) {
      tabs.setAttribute("aria-busy", "false");
      reload.disabled = false;
    }
  }
}

const evidenceGroups = [
  { key: "comfig", title: "Comfig", match: /^(comfig)/ },
  { key: "binds", title: "Binds", match: /^(binds)/ },
  { key: "gameplay", title: "Gameplay", match: /^(gameplay)/ },
  { key: "hud", title: "HUD", match: /^(hud)/ },
  { key: "crosshair", title: "Crosshair", match: /^(crosshair)/ },
  { key: "viewmodels", title: "Viewmodels", match: /^(viewmodels)/ },
  { key: "sounds", title: "Sounds", match: /^(sounds)/ },
  { key: "mods", title: "Mods · shipped 0.1.8", match: /^(mods)/ },
  { key: "files", title: "Files", match: /^(files)/ },
  { key: "launch", title: "Launch", match: /^(launch)/ },
  {
    key: "profiles",
    title: "Setup, profiles & recovery",
    match: /^(profile|first-|empty$|one$|many$|create$|absorb$|switch$|import$|folder-)/,
  },
  { key: "shared", title: "Updates & shared states", match: /^(update|release-|settings-)/ },
  { key: "inventory", title: "Inventory · development only", match: /^(inventory)/ },
  { key: "other", title: "Additional states", match: /./ },
];

async function loadEvidence() {
  try {
    const ledger = await jsonResource("audit/captures.json");
    const captures = (Array.isArray(ledger) ? ledger : ledger.captures || []).filter(
      (capture) => capture && capture.accepted !== false,
    );
    const groups = evidenceGroups.map((group) => ({ ...group, captures: [] }));
    captures.forEach((capture) => {
      const match =
        groups.find((group) => group.match.test(String(capture.name || ""))) || groups.at(-1);
      match.captures.push(capture);
    });
    const container = byId("evidence-groups");
    container.replaceChildren();
    let displayed = 0;
    groups
      .filter((group) => group.captures.length)
      .forEach((group) => {
        const details = element("details", "evidence-group");
        details.dataset.group = group.key;
        const summary = element("summary");
        summary.append(
          element("h3", "", group.title),
          element("span", "group-count", `${group.captures.length} captures`),
        );
        details.append(summary);
        const grid = element("div", "evidence-grid");
        group.captures.forEach((capture) => {
          const filename = String(capture.path || capture.file || "")
            .replaceAll("\\", "/")
            .split("/")
            .pop();
          if (!filename || !/^[\w .-]+\.(?:png|jpe?g|webp)$/i.test(filename)) return;
          const url = localResource(`audit/${encodeURIComponent(filename)}`);
          if (!url) return;
          displayed += 1;
          const name = titleCase(capture.name);
          const id = String(capture.id ?? displayed).padStart(3, "0");
          const note = String(capture.note || "");
          const baseline = String(capture.url || "").includes(":1422/")
            ? "0.1.8 · browser fixture"
            : group.key === "inventory"
              ? "Development only · browser fixture"
              : "Development · browser fixture";
          const figure = element("figure", "evidence-card");
          const button = element("button", "evidence-image-button");
          button.type = "button";
          button.setAttribute("aria-label", `Inspect capture ${id}: ${name}`);
          const image = element("img");
          image.src = url;
          image.alt = `${name} — captured application state`;
          image.loading = "lazy";
          image.decoding = "async";
          image.width = 1280;
          image.height = 720;
          image.addEventListener(
            "error",
            () => {
              button.replaceChildren(
                element(
                  "span",
                  "evidence-missing",
                  "Screenshot could not be loaded. Open the original file to inspect it.",
                ),
              );
            },
            { once: true },
          );
          button.append(image);
          button.addEventListener("click", () =>
            openImage({
              url,
              title: `${id} — ${name}`,
              kind: baseline,
              caption: note,
              alt: image.alt,
            }),
          );
          const caption = element("figcaption");
          const heading = element("div", "evidence-card-heading");
          heading.append(element("span", "capture-id", id), element("strong", "", name));
          caption.append(heading, element("span", "evidence-baseline", baseline));
          if (note) caption.append(element("p", "evidence-note", note));
          figure.append(button, caption);
          grid.append(figure);
        });
        details.append(grid);
        container.append(details);
      });
    byId("evidence-count").textContent = `${displayed} accepted captures · grouped by surface`;
    byId("evidence-status").textContent = "";
  } catch (error) {
    byId("evidence-count").textContent = "Capture ledger unavailable";
    byId("evidence-status").textContent =
      `${error.message} The audit document and ledger link remain available.`;
  }
}

const imageDialog = byId("image-dialog");
const lightboxImage = byId("lightbox-image");
const imageStage = byId("image-stage");
let imageZoom = "fit";
let imageOpener = null;
let imageLoadId = 0;

function fitScale() {
  const padding = window.innerWidth <= 520 ? 20 : 36;
  return Math.min(
    1,
    (imageStage.clientWidth - padding) / lightboxImage.naturalWidth,
    (imageStage.clientHeight - padding) / lightboxImage.naturalHeight,
  );
}
function updateImageZoom() {
  if (!lightboxImage.naturalWidth || !imageDialog.open) return;
  const scale = imageZoom === "fit" ? Math.max(0.05, fitScale()) : imageZoom;
  lightboxImage.style.width = `${Math.round(lightboxImage.naturalWidth * scale)}px`;
  lightboxImage.style.height = `${Math.round(lightboxImage.naturalHeight * scale)}px`;
  imageStage.classList.toggle("is-zoomed", imageZoom !== "fit");
  byId("zoom-value").textContent = imageZoom === "fit" ? "Fit" : `${Math.round(scale * 100)}%`;
  byId("zoom-out").disabled = scale <= 0.1;
  byId("zoom-in").disabled = scale >= 3;
}
function openImage({ url, title, kind, caption, alt }) {
  imageOpener = document.activeElement;
  const loadId = ++imageLoadId;
  imageZoom = "fit";
  byId("image-dialog-title").textContent = title;
  byId("image-dialog-kind").textContent = kind;
  byId("image-dialog-caption").textContent = caption || "";
  byId("image-original-link").href = url;
  lightboxImage.alt = alt || title;
  lightboxImage.style.removeProperty("width");
  lightboxImage.style.removeProperty("height");
  lightboxImage.onload = () => {
    if (loadId === imageLoadId) updateImageZoom();
  };
  lightboxImage.onerror = () => {
    if (loadId === imageLoadId)
      byId("image-dialog-caption").textContent =
        "This image could not be loaded. Its original link is available above.";
  };
  lightboxImage.src = url;
  if (!imageDialog.open) imageDialog.showModal();
  byId("close-image-dialog").focus();
  imageStage.scrollTo(0, 0);
  if (lightboxImage.complete) updateImageZoom();
}
function setZoom(zoom) {
  imageZoom = zoom;
  updateImageZoom();
  if (zoom === "fit") imageStage.scrollTo(0, 0);
}
byId("close-image-dialog").addEventListener("click", () => imageDialog.close());
imageDialog.addEventListener("close", () => {
  imageLoadId += 1;
  if (imageOpener?.isConnected) imageOpener.focus();
});
imageDialog.addEventListener("click", (event) => {
  if (event.target === imageDialog) {
    const rect = imageDialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      imageDialog.close();
  }
});
byId("zoom-fit").addEventListener("click", () => setZoom("fit"));
byId("zoom-original").addEventListener("click", () => setZoom(1));
byId("zoom-in").addEventListener("click", () =>
  setZoom(Math.min(3, (imageZoom === "fit" ? fitScale() : imageZoom) * 1.25)),
);
byId("zoom-out").addEventListener("click", () =>
  setZoom(Math.max(0.1, (imageZoom === "fit" ? fitScale() : imageZoom) / 1.25)),
);
lightboxImage.addEventListener("click", () => setZoom(imageZoom === "fit" ? 1 : "fit"));
new ResizeObserver(() => {
  if (imageDialog.open && imageZoom === "fit") updateImageZoom();
}).observe(imageStage);

const systemReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let forcedReducedMotion = false;
function updateMotionPreference() {
  const reduced = systemReducedMotion.matches || forcedReducedMotion;
  document.body.classList.toggle("reduce-demo-motion", reduced);
  const button = byId("reduce-demo-motion");
  button.setAttribute("aria-pressed", String(reduced));
  button.disabled = systemReducedMotion.matches;
  button.textContent = reduced ? "Sample motion reduced" : "Reduce sample motion";
  byId("motion-preference").textContent = systemReducedMotion.matches
    ? "Your system requests reduced motion. All decorative transitions are disabled."
    : forcedReducedMotion
      ? "Transitions are disabled in these specimens. State changes remain immediate."
      : "Motion follows your system preference. You can also reduce it for these samples.";
}
byId("reduce-demo-motion").addEventListener("click", () => {
  forcedReducedMotion = !forcedReducedMotion;
  updateMotionPreference();
});
systemReducedMotion.addEventListener("change", updateMotionPreference);

const sampleTabs = [...document.querySelectorAll('.sample-navigation [role="tab"]')];
function selectSampleTab(index, focus = false) {
  const details = index === 1;
  sampleTabs.forEach((tab, tabIndex) => {
    tab.setAttribute("aria-selected", String(tabIndex === index));
    tab.tabIndex = tabIndex === index ? 0 : -1;
  });
  document.querySelector(".sample-navigation").classList.toggle("is-details", details);
  const view = byId("sample-view");
  view.setAttribute("aria-labelledby", sampleTabs[index].id);
  view.classList.toggle("is-details", details);
  view.querySelector(".sample-view-label").textContent =
    `${details ? "Details" : "Overview"} selected`;
  view.classList.remove("is-changing");
  if (!(systemReducedMotion.matches || forcedReducedMotion)) {
    void view.offsetWidth;
    view.classList.add("is-changing");
  }
  if (focus) sampleTabs[index].focus();
}
sampleTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectSampleTab(index));
  tab.addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      selectSampleTab(event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index, true);
    }
  });
});
byId("sample-view").addEventListener("animationend", () =>
  byId("sample-view").classList.remove("is-changing"),
);

const sampleMenu = byId("sample-menu");
const sampleMenuTrigger = byId("sample-menu-trigger");
const sampleMenuItems = [...sampleMenu.querySelectorAll('[role="menuitem"]')];
function closeSampleMenu(restoreFocus = false) {
  sampleMenu.hidden = true;
  sampleMenuTrigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) sampleMenuTrigger.focus();
}
function openSampleMenu(index = 0) {
  sampleMenu.hidden = false;
  sampleMenuTrigger.setAttribute("aria-expanded", "true");
  sampleMenuItems[index].focus();
}
sampleMenuTrigger.addEventListener("click", () =>
  sampleMenu.hidden ? openSampleMenu() : closeSampleMenu(true),
);
sampleMenuTrigger.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    openSampleMenu(event.key === "ArrowUp" ? sampleMenuItems.length - 1 : 0);
  }
});
sampleMenuItems.forEach((item, index) => {
  item.addEventListener("click", () => {
    byId("sample-menu-status").textContent =
      `${item.textContent} selected. No application action was taken.`;
    closeSampleMenu(true);
  });
  item.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSampleMenu(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      sampleMenuItems[
        (index + (event.key === "ArrowDown" ? 1 : -1) + sampleMenuItems.length) %
          sampleMenuItems.length
      ].focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      sampleMenuItems[event.key === "Home" ? 0 : sampleMenuItems.length - 1].focus();
    } else if (event.key === "Tab") closeSampleMenu(true);
  });
});
document.addEventListener("pointerdown", (event) => {
  if (!sampleMenu.hidden && !event.target.closest(".sample-menu-host")) closeSampleMenu(false);
});
byId("open-sample-dialog").addEventListener("click", () => byId("sample-dialog").showModal());

const feedbackButton = byId("play-feedback");
const feedbackLabel = byId("sample-feedback");
let feedbackTimers = [];
function stopSampleFeedback(message = "Sample ready") {
  feedbackTimers.forEach(clearTimeout);
  feedbackTimers = [];
  feedbackLabel.classList.remove("is-saving", "is-saved");
  feedbackLabel.textContent = message;
  feedbackButton.disabled = false;
}
feedbackButton.addEventListener("click", () => {
  stopSampleFeedback("Sample started");
  feedbackButton.disabled = true;
  feedbackTimers.push(
    setTimeout(() => {
      feedbackLabel.classList.add("is-saving");
      feedbackLabel.textContent = "Sample: Saving…";
    }, 400),
  );
  feedbackTimers.push(
    setTimeout(() => {
      feedbackLabel.classList.replace("is-saving", "is-saved");
      feedbackLabel.textContent = "Sample: Saved";
    }, 1200),
  );
  feedbackTimers.push(setTimeout(() => stopSampleFeedback("Sample complete"), 2800));
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (feedbackTimers.length) stopSampleFeedback("Sample stopped while hidden");
    closeSampleMenu(false);
  }
});

byId("reload-options").addEventListener("click", loadOptions);
byId("expand-evidence").addEventListener("click", () => {
  const groups = [...document.querySelectorAll(".evidence-group")];
  const expand = groups.some((group) => !group.open);
  groups.forEach((group) => {
    group.open = expand;
  });
  byId("expand-evidence").textContent = expand ? "Collapse groups" : "Expand groups";
});
updateMotionPreference();
loadOptions();
loadEvidence();
