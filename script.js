(function () {
  "use strict";

  // ---------- state ----------
  let images = {}; // id -> image record
  let order = []; // array of ids, index 0 = position 1
  let selectedIds = new Set();
  let activeId = null;
  let anchorId = null; // for shift-click range selection
  let draggedId = null;
  let uid = 0;

  // ---------- quick tag presets (persisted locally in this browser) ----------
  const PRESET_STORAGE_KEY = "contactSheet.quickTags";
  let presetTags = loadPresetTags();

  function loadPresetTags() {
    try {
      const raw = localStorage.getItem(PRESET_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      /* ignore */
    }
    return ["Biosector"]; // starter example — edit or remove freely
  }
  function savePresetTags() {
    try {
      localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presetTags));
    } catch (e) {
      /* storage unavailable — presets just won't persist */
    }
  }
  function addPresetTag(name) {
    const clean = name.trim();
    if (!clean) return;
    if (presetTags.some((t) => t.toLowerCase() === clean.toLowerCase())) return;
    presetTags.push(clean);
    savePresetTags();
    renderSidebar();
  }
  function removePresetTag(name) {
    presetTags = presetTags.filter((t) => t !== name);
    savePresetTags();
    renderSidebar();
  }

  // ---------- per-tag colors (deterministic, so the same tag always looks the same) ----------
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (Math.imul(hash, 31) + str.charCodeAt(i)) >>> 0;
    }
    return hash;
  }
  const tagColorCache = {};
  function getTagHue(name) {
    const key = name.trim().toLowerCase();
    if (tagColorCache[key] === undefined) {
      tagColorCache[key] = hashString(key) % 360;
    }
    return tagColorCache[key];
  }
  function tagColorStyle(name) {
    const hue = getTagHue(name);
    return `--tag-bg:hsla(${hue},65%,45%,0.16); --tag-border:hsla(${hue},65%,55%,0.5); --tag-fg:hsl(${hue},80%,74%); --tag-dot:hsl(${hue},75%,58%);`;
  }

  const el = {
    fileInput: document.getElementById("file-input"),
    btnAddMore: document.getElementById("btn-add-more"),
    btnExport: document.getElementById("btn-export"),
    dropZone: document.getElementById("drop-zone"),
    emptyState: document.getElementById("empty-state"),
    gridWrap: document.getElementById("grid-wrap"),
    grid: document.getElementById("grid"),
    sidebar: document.getElementById("sidebar"),
    headerCount: document.getElementById("header-count"),
    main: document.getElementById("main"),
    exportStatus: document.getElementById("export-status"),
    exportProgress: document.getElementById("export-progress"),
    confirmOverlay: document.getElementById("confirm-overlay"),
    confirmSummary: document.getElementById("confirm-summary"),
    confirmCancel: document.getElementById("confirm-cancel"),
    confirmGo: document.getElementById("confirm-go"),
    confirmZipName: document.getElementById("confirm-zip-name"),
    confirmZipPreview: document.getElementById("confirm-zip-preview"),
    optStatusTags: document.getElementById("opt-status-tags"),
    optMode: document.getElementById("opt-mode"),
    optWidth: document.getElementById("opt-width"),
    optHeight: document.getElementById("opt-height"),
    optFormat: document.getElementById("opt-format"),
    optPrefix: document.getElementById("opt-prefix"),
    dimX: document.getElementById("dim-x"),
    dimUnitLabel: document.getElementById("dim-unit-label"),
    dimFieldsWrap: document.getElementById("dim-fields"),
    padFieldsWrap: document.getElementById("pad-fields"),
    optPadWidth: document.getElementById("opt-pad-width"),
    optPadHeight: document.getElementById("opt-pad-height"),
    optPadContentHeight: document.getElementById("opt-pad-content-height"),
  };

  function updateDimFieldsVisibility() {
    const mode = el.optMode.value;
    if (mode === "pad") {
      el.dimFieldsWrap.style.display = "none";
      el.padFieldsWrap.style.display = "flex";
      return;
    }
    el.padFieldsWrap.style.display = "none";
    if (mode === "exact") {
      el.dimFieldsWrap.style.display = "flex";
      el.optWidth.style.display = "inline-block";
      el.dimX.style.display = "inline";
      el.optHeight.style.display = "inline-block";
      el.dimUnitLabel.style.display = "inline";
      el.dimUnitLabel.textContent = "px";
    } else if (mode === "scale") {
      el.dimFieldsWrap.style.display = "flex";
      el.optWidth.style.display = "none";
      el.dimX.style.display = "none";
      el.optHeight.style.display = "inline-block";
      el.dimUnitLabel.style.display = "inline";
      el.dimUnitLabel.textContent = "px height";
    } else {
      el.dimFieldsWrap.style.display = "none";
      el.optWidth.style.display = "none";
      el.dimX.style.display = "none";
      el.optHeight.style.display = "none";
      el.dimUnitLabel.style.display = "none";
    }
  }
  el.optMode.addEventListener("change", updateDimFieldsVisibility);

  function updateNamePreview() {
    const node = document.getElementById("sb-name-preview");
    if (!node || !activeId || !images[activeId]) return;
    const rec = images[activeId];
    const pos = order.indexOf(activeId) + 1;
    const outExt = resolveExportExt(rec);
    const filename = buildExportFilename(
      rec,
      pos,
      order.length,
      el.optPrefix.checked,
      outExt,
    );
    node.innerHTML = `<b>Exports as</b> ${escapeHtml(filename)}`;
  }
  el.optFormat.addEventListener("change", updateNamePreview);
  el.optPrefix.addEventListener("change", updateNamePreview);

  // ---------- file ingestion ----------
  function splitName(filename) {
    const idx = filename.lastIndexOf(".");
    if (idx <= 0) return { base: filename, ext: "" };
    return {
      base: filename.slice(0, idx),
      ext: filename.slice(idx + 1).toLowerCase(),
    };
  }

  function addFiles(fileList) {
    const files = Array.from(fileList).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length === 0) return;

    files.forEach((file) => {
      const id = "img" + uid++;
      const url = URL.createObjectURL(file);
      const { base, ext } = splitName(file.name);
      const rec = {
        id,
        file,
        url,
        baseName: base,
        ext: ext || "jpg",
        tags: [],
        naturalWidth: 0,
        naturalHeight: 0,
      };
      images[id] = rec;
      order.push(id);

      const probe = new Image();
      probe.onload = function () {
        rec.naturalWidth = probe.naturalWidth;
        rec.naturalHeight = probe.naturalHeight;
        renderSidebar(); // in case this image is currently shown
      };
      probe.src = url;
    });

    render();
  }

  el.btnAddMore.addEventListener("click", () => el.fileInput.click());
  el.dropZone.addEventListener("click", () => el.fileInput.click());
  el.fileInput.addEventListener("change", (e) => {
    addFiles(e.target.files);
    el.fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((evt) => {
    el.main.addEventListener(evt, (e) => {
      e.preventDefault();
      if (order.length === 0) el.dropZone.classList.add("drag-active");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    el.main.addEventListener(evt, () =>
      el.dropZone.classList.remove("drag-active"),
    );
  });
  el.main.addEventListener("drop", (e) => {
    e.preventDefault();
    if (draggedId) return; // this was a card reorder, not a file drop
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      addFiles(e.dataTransfer.files);
    }
  });

  // ---------- selection ----------
  function selectImage(id, evt) {
    if (evt.shiftKey && anchorId && images[anchorId]) {
      const startIdx = order.indexOf(anchorId);
      const endIdx = order.indexOf(id);
      const a = Math.min(startIdx, endIdx),
        b = Math.max(startIdx, endIdx);
      selectedIds = new Set(order.slice(a, b + 1));
      activeId = id;
    } else if (evt.metaKey || evt.ctrlKey) {
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
        if (activeId === id) {
          const remaining = order.filter((oid) => selectedIds.has(oid));
          activeId = remaining.length ? remaining[remaining.length - 1] : null;
        }
      } else {
        selectedIds.add(id);
        activeId = id;
        anchorId = id;
      }
    } else {
      selectedIds = new Set([id]);
      activeId = id;
      anchorId = id;
    }
    render();
  }

  function clearSelection() {
    selectedIds = new Set();
    activeId = null;
    render();
  }

  // ---------- reordering ----------
  function moveToPosition(id, targetPos1Indexed) {
    const total = order.length;
    let idx = Math.min(Math.max(targetPos1Indexed, 1), total) - 1;
    order = order.filter((oid) => oid !== id);
    order.splice(idx, 0, id);
  }

  function reorderByDrag(draggedId, targetId, before) {
    if (draggedId === targetId) return;
    order = order.filter((oid) => oid !== draggedId);
    let idx = order.indexOf(targetId);
    if (!before) idx += 1;
    order.splice(idx, 0, draggedId);
  }

  // ---------- tags ----------
  function addTagsToActive(rawInput) {
    const tags = rawInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length === 0) return;
    const targets =
      selectedIds.size > 0 ? selectedIds : new Set(activeId ? [activeId] : []);
    targets.forEach((id) => {
      const rec = images[id];
      if (!rec) return;
      tags.forEach((t) => {
        if (
          !rec.tags.some(
            (existing) => existing.toLowerCase() === t.toLowerCase(),
          )
        ) {
          rec.tags.push(t);
        }
      });
    });
    render();
  }

  function removeTagFromActive(tag) {
    if (!activeId) return;
    const targets = selectedIds.size > 0 ? selectedIds : new Set([activeId]);
    const tagLower = tag.toLowerCase();
    targets.forEach((id) => {
      const rec = images[id];
      if (!rec) return;
      if (rec.tags.some((t) => t.toLowerCase() === tagLower)) {
        rec.tags = rec.tags.filter((t) => t.toLowerCase() !== tagLower);
      }
    });
    render();
  }

  // ---------- rendering ----------
  function render() {
    el.headerCount.textContent = order.length
      ? order.length + (order.length === 1 ? " image" : " images")
      : "";
    el.btnExport.disabled = order.length === 0;

    if (order.length === 0) {
      el.emptyState.style.display = "flex";
      el.gridWrap.style.display = "none";
    } else {
      el.emptyState.style.display = "none";
      el.gridWrap.style.display = "block";
      renderGrid();
    }
    renderSidebar();
  }

  function renderGrid() {
    el.grid.innerHTML = "";
    order.forEach((id, i) => {
      const rec = images[id];
      const card = document.createElement("div");
      card.className = "card";
      if (selectedIds.has(id)) card.classList.add("selected");
      if (activeId === id) card.classList.add("active");
      card.draggable = true;
      card.dataset.id = id;

      card.innerHTML = `
        <div class="card-thumb">
          <img src="${rec.url}" alt="" draggable="false">
          <div class="pos-badge">${i + 1}</div>
        </div>
        <div class="card-info">
          <div class="card-name">${escapeHtml(rec.baseName)}.${rec.ext}</div>
          ${
            rec.tags.length
              ? `
            <div class="card-tag-stack">
              ${rec.tags.map((t) => `<div class="card-tag-pill" style="${tagColorStyle(t)}">${escapeHtml(t)}</div>`).join("")}
            </div>
          `
              : ""
          }
        </div>
      `;

      card.addEventListener("click", (e) => selectImage(id, e));

      card.addEventListener("dragstart", (e) => {
        draggedId = id;
        e.dataTransfer.effectAllowed = "move";
        setTimeout(() => card.classList.add("dragging"), 0);
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        document
          .querySelectorAll(".drop-before,.drop-after")
          .forEach((c) => c.classList.remove("drop-before", "drop-after"));
      });
      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!draggedId || draggedId === id) return;
        const rect = card.getBoundingClientRect();
        const before = e.clientX - rect.left < rect.width / 2;
        card.classList.toggle("drop-before", before);
        card.classList.toggle("drop-after", !before);
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("drop-before", "drop-after");
      });
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = card.getBoundingClientRect();
        const before = e.clientX - rect.left < rect.width / 2;
        card.classList.remove("drop-before", "drop-after");
        if (draggedId && draggedId !== id) {
          reorderByDrag(draggedId, id, before);
          draggedId = null;
          render();
        }
      });

      el.grid.appendChild(card);
    });
  }

  el.grid.addEventListener("dragover", (e) => e.preventDefault());

  el.main.addEventListener("click", (e) => {
    if (
      e.target === el.main ||
      e.target.id === "grid-wrap" ||
      e.target.id === "grid"
    ) {
      clearSelection();
    }
  });

  function renderQuickTagsHtml(hasSelection) {
    return `
      <div class="quick-tags-section">
        <label class="field-label">Quick tags</label>
        ${
          hasSelection
            ? `<div class="quick-tags-hint">Click a tag to add it to the current selection.</div>`
            : `<div class="quick-tags-hint">Select an image to apply these. You can still add or remove presets here.</div>`
        }
        ${
          presetTags.length
            ? `
          <div class="quick-tag-list" id="qt-list">
            ${presetTags
              .map(
                (t) => `
              <div class="quick-tag-chip ${hasSelection ? "" : "disabled"}" data-qt="${escapeAttr(t)}" style="${tagColorStyle(t)}">
                <span class="qt-dot"></span>${escapeHtml(t)}<button class="qt-remove" data-qt-remove="${escapeAttr(t)}" title="Remove preset">×</button>
              </div>
            `,
              )
              .join("")}
          </div>
        `
            : `<div class="quick-tag-empty">No quick tags yet</div>`
        }
        <div class="quick-tag-add-row">
          <input type="text" id="qt-new-input" placeholder="New quick tag, e.g. Biosector">
          <button class="btn" id="qt-new-add">Save</button>
        </div>
      </div>
    `;
  }

  function wireQuickTagsHtml() {
    document.querySelectorAll(".quick-tag-chip[data-qt]").forEach((chip) => {
      chip.addEventListener("click", (e) => {
        if (e.target.closest("[data-qt-remove]")) return;
        if (selectedIds.size === 0) return;
        addTagsToActive(chip.dataset.qt);
      });
    });
    document.querySelectorAll("[data-qt-remove]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        removePresetTag(btn.dataset.qtRemove);
      });
    });
    const qtInput = document.getElementById("qt-new-input");
    const qtAdd = document.getElementById("qt-new-add");
    qtAdd.addEventListener("click", () => {
      addPresetTag(qtInput.value);
      qtInput.value = "";
      qtInput.focus();
    });
    qtInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        addPresetTag(qtInput.value);
        qtInput.value = "";
      }
    });
  }

  function renderSidebar() {
    if (selectedIds.size === 0 || !activeId || !images[activeId]) {
      el.sidebar.innerHTML = `
        <div class="sidebar-empty">
          <div class="mark-big"></div>
          Select an image to edit its name, position, and tags.
        </div>
        <div class="divider"></div>
        ${renderQuickTagsHtml(false)}
      `;
      wireQuickTagsHtml();
      return;
    }

    const rec = images[activeId];
    const pos = order.indexOf(activeId) + 1;
    const multi = selectedIds.size > 1;
    const dims = rec.naturalWidth
      ? `${rec.naturalWidth} × ${rec.naturalHeight} px`
      : "—";

    el.sidebar.innerHTML = `
      <div class="sel-heading">${multi ? `<b>${selectedIds.size}</b> images selected` : `Editing <b>image ${pos}</b>`}</div>

      <div class="thumb-preview"><img src="${rec.url}" alt=""></div>

      <div class="field-group">
        <label class="field-label">Name</label>
        <input type="text" class="text-input" id="sb-name" value="${escapeAttr(rec.baseName)}" spellcheck="false">
        <div class="name-preview" id="sb-name-preview"><b>Exports as</b> ${escapeHtml(buildExportFilename(rec, pos, order.length, el.optPrefix.checked, resolveExportExt(rec)))}</div>
      </div>

      <div class="field-group">
        <label class="field-label">Position</label>
        <input type="number" class="text-input" id="sb-position" value="${pos}" min="1" max="${order.length}" style="width:90px;">
      </div>

      <div class="meta-row"><span>Dimensions</span><span>${dims}</span></div>
      <div class="meta-row"><span>Format</span><span>.${rec.ext}</span></div>

      <div class="divider"></div>

      <label class="field-label">Tags</label>
      ${multi ? `<div class="tag-hint">Adding a tag applies it to all ${selectedIds.size} selected images.</div>` : ""}
      <div class="tag-input-row">
        <input type="text" id="sb-tag-input" placeholder="e.g. final, v2, web">
        <button class="btn" id="sb-tag-add">Add</button>
      </div>
      <div class="tag-list" id="sb-tag-list">
        ${
          rec.tags.length
            ? rec.tags
                .map(
                  (t) => `
          <div class="tag-chip" style="${tagColorStyle(t)}">${escapeHtml(t)}<button data-tag="${escapeAttr(t)}" title="Remove tag">×</button></div>
        `,
                )
                .join("")
            : '<span class="no-tags">No tags yet</span>'
        }
      </div>

      <div class="divider"></div>
      ${renderQuickTagsHtml(true)}

      ${
        multi
          ? `
        <div class="divider"></div>
        <details class="collapsible-section">
          <summary>Also selected <span class="count-badge">${selectedIds.size - 1}</span></summary>
          <div class="multi-list">
            ${order
              .filter((id) => selectedIds.has(id))
              .map((id) => {
                const r = images[id];
                const p = order.indexOf(id) + 1;
                return `<div class="multi-list-item ${id === activeId ? "is-active" : ""}">${p}. ${escapeHtml(r.baseName)}.${r.ext}</div>`;
              })
              .join("")}
          </div>
        </details>
      `
          : ""
      }
    `;

    document.getElementById("sb-name").addEventListener("input", (e) => {
      rec.baseName = e.target.value;
      renderGrid();
      updateNamePreview();
    });
    document.getElementById("sb-name").addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.target.blur();
    });

    document.getElementById("sb-position").addEventListener("change", (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val)) {
        moveToPosition(activeId, val);
        render();
      }
    });

    const tagInput = document.getElementById("sb-tag-input");
    document.getElementById("sb-tag-add").addEventListener("click", () => {
      addTagsToActive(tagInput.value);
      tagInput.value = "";
      tagInput.focus();
    });
    tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        addTagsToActive(tagInput.value);
        tagInput.value = "";
      }
    });

    document
      .getElementById("sb-tag-list")
      .querySelectorAll("button[data-tag]")
      .forEach((btn) => {
        btn.addEventListener("click", () =>
          removeTagFromActive(btn.dataset.tag),
        );
      });

    wireQuickTagsHtml();
  }

  function escapeHtml(str) {
    return String(str).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }
  function escapeAttr(str) {
    return escapeHtml(str);
  }

  // ---------- export ----------
  function sanitizeFilename(name) {
    let clean = name.replace(/[\/\\:*?"<>|]/g, "").trim();
    clean = clean.replace(/\s+/g, "-");
    return clean || "image";
  }

  function extToMime(ext) {
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    return "image/png";
  }

  function resolveExportExt(rec) {
    const fmt = el.optFormat.value;
    if (fmt === "keep") {
      if (["jpg", "jpeg", "png", "webp"].includes(rec.ext))
        return rec.ext === "jpeg" ? "jpg" : rec.ext;
      return "jpg"; // fallback for formats canvas can't safely re-encode as-is
    }
    return fmt;
  }

  function padWidthFor(total) {
    return Math.max(2, String(total).length);
  }

  function resizeStatusSuffix() {
    const mode = el.optMode.value;
    if (mode === "scale") return "scaled";
    if (mode === "pad") return "letterbox";
    if (mode === "exact") return "resized";
    return ""; // 'none' — original size, no suffix
  }

  function buildExportFilename(rec, posIndex1, total, includePrefix, outExt) {
    const parts = [rec.baseName, ...rec.tags].filter(Boolean);
    let base = sanitizeFilename(parts.join("_"));
    if (includePrefix) {
      base = String(posIndex1).padStart(padWidthFor(total), "0") + "_" + base;
    }
    return base + "." + outExt;
  }

  function renderResized(rec, outExt) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = function () {
        const mode = el.optMode.value;

        if (mode === "pad") {
          const canvasW = Math.max(
            1,
            parseInt(el.optPadWidth.value, 10) || rec.naturalWidth,
          );
          const canvasH = Math.max(
            1,
            parseInt(el.optPadHeight.value, 10) || rec.naturalHeight,
          );
          const wantedContentH = Math.max(
            1,
            parseInt(el.optPadContentHeight.value, 10) || canvasH,
          );

          // Scale by height first, as requested; if that would overflow the
          // canvas width, fall back to scaling by width so content never
          // gets cropped off the canvas.
          let scale = Math.min(wantedContentH, canvasH) / rec.naturalHeight;
          let contentW = rec.naturalWidth * scale;
          if (contentW > canvasW) {
            scale = canvasW / rec.naturalWidth;
          }
          contentW = Math.max(1, Math.round(rec.naturalWidth * scale));
          const contentH = Math.max(1, Math.round(rec.naturalHeight * scale));

          const canvas = document.createElement("canvas");
          canvas.width = canvasW;
          canvas.height = canvasH;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, canvasW, canvasH);

          const x = Math.round((canvasW - contentW) / 2);
          const y = Math.round((canvasH - contentH) / 2);
          ctx.drawImage(img, x, y, contentW, contentH);

          canvas.toBlob(
            (blob) => {
              if (blob) resolve(blob);
              else reject(new Error("Failed to encode image"));
            },
            extToMime(outExt),
            0.92,
          );
          return;
        }

        const targetW = Math.max(
          1,
          parseInt(el.optWidth.value, 10) || rec.naturalWidth,
        );
        const targetH = Math.max(
          1,
          parseInt(el.optHeight.value, 10) || rec.naturalHeight,
        );

        let w = rec.naturalWidth,
          h = rec.naturalHeight;
        if (mode === "exact") {
          w = targetW;
          h = targetH;
        } else if (mode === "scale") {
          h = targetH;
          w = Math.max(
            1,
            Math.round(rec.naturalWidth * (targetH / rec.naturalHeight)),
          );
        }

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");

        if (outExt === "jpg") {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
        }
        ctx.drawImage(img, 0, 0, w, h);

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Failed to encode image"));
          },
          extToMime(outExt),
          0.92,
        );
      };
      img.onerror = reject;
      img.src = rec.url;
    });
  }

  async function exportAll(zipFileName) {
    if (order.length === 0) return;
    el.btnExport.disabled = true;
    el.exportStatus.classList.add("visible");
    el.exportProgress.textContent = `0 / ${order.length}`;

    try {
      const zip = new JSZip();
      const usedNames = new Set();
      const includePrefix = el.optPrefix.checked;

      for (let i = 0; i < order.length; i++) {
        const rec = images[order[i]];
        const outExt = resolveExportExt(rec);
        const blob = await renderResized(rec, outExt);

        let filename = buildExportFilename(
          rec,
          i + 1,
          order.length,
          includePrefix,
          outExt,
        );
        let n = 2;
        const dot = filename.lastIndexOf(".");
        const stem = filename.slice(0, dot),
          ext = filename.slice(dot + 1);
        while (usedNames.has(filename)) {
          filename = stem + "_" + n + "." + ext;
          n++;
        }
        usedNames.add(filename);

        zip.file(filename, blob);
        el.exportProgress.textContent = `${i + 1} / ${order.length}`;
      }

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = zipFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      alert("Export failed: " + err.message);
    } finally {
      el.exportStatus.classList.remove("visible");
      el.btnExport.disabled = order.length === 0;
    }
  }

  // ---------- zip filename (persisted locally in this browser) ----------
  const ZIP_NAME_STORAGE_KEY = "contactSheet.zipStem";
  let zipStem = loadZipStem();
  function loadZipStem() {
    try {
      const raw = localStorage.getItem(ZIP_NAME_STORAGE_KEY);
      if (raw) return raw;
    } catch (e) {
      /* ignore */
    }
    return "images";
  }
  function saveZipStem(name) {
    try {
      localStorage.setItem(ZIP_NAME_STORAGE_KEY, name);
    } catch (e) {
      /* storage unavailable */
    }
  }
  function sanitizeZipStem(name) {
    let clean = name.replace(/[\/\\:*?"<>|]/g, "").trim();
    clean = clean.replace(/\s+/g, "-");
    clean = clean.replace(/\.zip$/i, "");
    return clean || "images";
  }
  function finalZipName(stem) {
    let base = sanitizeZipStem(stem);
    if (el.optStatusTags.checked) {
      base += "-renamed";
      const suffix = resizeStatusSuffix();
      if (suffix) base += "-" + suffix;
    }
    return base + ".zip";
  }
  function updateZipPreview() {
    el.confirmZipPreview.innerHTML = `<b>Exports as</b> ${escapeHtml(finalZipName(el.confirmZipName.value))}`;
  }

  function openExportConfirm() {
    const mode = el.optMode.value;
    const height = parseInt(el.optHeight.value, 10) || 0;
    const width = parseInt(el.optWidth.value, 10) || 0;
    const fmt = el.optFormat.options[el.optFormat.selectedIndex].text;

    let sizeRow;
    if (mode === "scale") {
      sizeRow = `<div class="ms-row"><span>Height</span><span>${height} px <span style="color:var(--text-faint);">(width auto)</span></span></div>`;
    } else if (mode === "exact") {
      sizeRow = `<div class="ms-row"><span>Exact size</span><span>${width} × ${height} px</span></div>`;
    } else if (mode === "pad") {
      const padW = parseInt(el.optPadWidth.value, 10) || 0;
      const padH = parseInt(el.optPadHeight.value, 10) || 0;
      const contentH = parseInt(el.optPadContentHeight.value, 10) || 0;
      sizeRow = `<div class="ms-row"><span>Canvas</span><span>${padW} × ${padH} px</span></div>
      <div class="ms-row"><span>Content height</span><span>${contentH} px, centered on black</span></div>`;
    } else {
      sizeRow = `<div class="ms-row"><span>Size</span><span>Original (no resize)</span></div>`;
    }

    el.confirmSummary.innerHTML = `
      <div class="ms-row"><span>Images</span><span>${order.length}</span></div>
      ${sizeRow}
      <div class="ms-row"><span>Format</span><span>${escapeHtml(fmt)}</span></div>
    `;
    el.confirmZipName.value = zipStem;
    updateZipPreview();
    el.confirmOverlay.classList.add("visible");
    el.confirmZipName.focus();
    el.confirmZipName.select();
  }
  function closeExportConfirm() {
    el.confirmOverlay.classList.remove("visible");
  }
  el.confirmCancel.addEventListener("click", closeExportConfirm);
  el.confirmOverlay.addEventListener("click", (e) => {
    if (e.target === el.confirmOverlay) closeExportConfirm();
  });
  el.confirmZipName.addEventListener("input", updateZipPreview);
  el.confirmGo.addEventListener("click", () => {
    zipStem = sanitizeZipStem(el.confirmZipName.value);
    saveZipStem(zipStem);
    const outputName = finalZipName(zipStem);
    closeExportConfirm();
    exportAll(outputName);
  });
  el.confirmZipName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.confirmGo.click();
  });

  el.btnExport.addEventListener("click", openExportConfirm);

  // ---------- keyboard ----------
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (el.confirmOverlay.classList.contains("visible")) closeExportConfirm();
      else clearSelection();
    }
  });

  updateDimFieldsVisibility();
  render();
})();
