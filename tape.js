/* ===========================================================
   Tape Punch — punch-tape generator
   Geometry matches the Arduining.com "Punched Tape" reference PDF,
   measured directly from a 300dpi render of the source artwork.

   Only the CIRCLE is a real physical hole: it's the clock/sprocket
   track that drives the reader, and it's punched on every single
   row regardless of data value. The second CIRCLE next to it is not a
   hole at all — it's a blank cell a human fills in by hand with
   ink to write the data bit (filled in = 1, left blank = 0). The
   reader's photodiode/switch on the data pin reads "ink present"
   vs "no ink" the same way it would read "hole" vs "no hole" on a
   machine-punched tape.

   ROW_PITCH_MM is the mechanically important number: it's what
   "how fast the tape is pulled through the reader" turns into
   electrically. Every clock pulse in the sketch corresponds to
   one row here, so this pitch is the tape's real "clock rate" in
   physical space.
   =========================================================== */

// ---------- Physical constants (mm) ----------
// Measured from the reference PDF at 300dpi (11.811 px/mm):
//   row pitch (clock-to-clock along strip axis)    ≈ 71.6 px → 6.06 mm
//   circle diameter (the only real hole)            ≈ 68.2 px → 5.77 mm
//   data circle size (hand-inked, same size)   ≈ 68.2 px → 5.77 mm
//   clock-track inset from its edge                 ≈ 74.4 px → 6.30 mm
//   data-track inset from its (opposite) edge       ≈ 70.9 px → 6.00 mm
const TAPE_WIDTH_MM     = 25.0;   // strip width, matches reference PDF
const ROW_PITCH_MM      = 6.06;   // the tape's "clock rate" — distance between successive clock pulses
const HOLE_DIAM_MM      = 5.77;   // clock hole diameter, and matching size for the data cell circle
const CLOCK_INSET_MM    = 6.30;   // clock hole track distance from its edge of the strip
const DATA_INSET_MM     = 6.00;   // data cell track distance from its (opposite) edge of the strip
const DIAGONAL_DEG      = 42;     // visual diagonal angle of the strip, matches reference art
const BYTE_ROWS         = 8;

// Along-axis stagger between the clock hole and its same-row data cell.
// Chosen (not measured from the reference — a deliberate design choice) as
// half a hole width, with the clock hole always leading: as the tape feeds
// through the reader, the clock contact reaches each row's clock hole
// first, and only half a hole-diameter later does the data contact reach
// that row's data cell. This keeps the two contacts from ever being over
// their respective row features — and therefore both "active" — at the
// same instant, rather than relying solely on the sketch's software
// debounce delay for separation.
const CLOCK_LEAD_MM     = HOLE_DIAM_MM / 2;  // ≈ 2.885 mm, clock always first

// ---------- Paper sizes (mm) ----------
const PAPER = {
  letter: { w: 215.9, h: 279.4, name: "US Letter" },
  a4:     { w: 210.0, h: 297.0, name: "A4" }
};

const MM_PER_IN = 25.4;

// ---------- State ----------
let state = {
  bytes: [],
  zoom: 1.0
};

// ================= Encoding =================

function textToBytes(str) {
  const bytes = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    // Fold to single bytes; anything above 0xFF is masked (this is a byte-oriented mechanical medium)
    bytes.push(cp & 0xFF);
  }
  return bytes;
}

function hexToBytes(str) {
  const clean = str.replace(/0x/gi, " ").match(/[0-9a-fA-F]{1,2}/g) || [];
  return clean.map(h => parseInt(h, 16) & 0xFF);
}

function patternToBytes(byteStr, count) {
  const val = parseInt(byteStr, 2) & 0xFF;
  return new Array(Math.max(1, count)).fill(val);
}

function byteToBits(b) {
  // MSB first, matching the reader sketch's Byte = (Byte<<1) | bit sampling order
  const bits = [];
  for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  return bits;
}

// ================= Building the byte sequence =================

function buildByteSequence() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  let bytes = [];

  if (mode === "text") {
    bytes = textToBytes(document.getElementById("text-input").value || "");
  } else if (mode === "bytes") {
    bytes = hexToBytes(document.getElementById("hex-input").value || "");
  } else if (mode === "pattern") {
    const b = document.getElementById("pattern-byte").value;
    const n = parseInt(document.getElementById("pattern-count").value, 10) || 1;
    bytes = patternToBytes(b, n);
  }

  const lenMode = document.querySelector('input[name="lenmode"]:checked').value;
  if (lenMode === "fixed") {
    const targetVal = parseFloat(document.getElementById("fixed-length").value) || 0;
    const unit = document.getElementById("fixed-length-unit").value;
    let targetBytes;
    if (unit === "bytes") {
      targetBytes = Math.round(targetVal);
    } else {
      let mm = targetVal;
      if (unit === "cm") mm = targetVal * 10;
      if (unit === "in") mm = targetVal * MM_PER_IN;
      targetBytes = Math.max(0, Math.round(mm / (ROW_PITCH_MM * BYTE_ROWS)));
    }

    if (bytes.length === 0) {
      bytes = new Array(targetBytes).fill(0);
    } else if (bytes.length < targetBytes) {
      // pad with blank (all-zero) rows rather than truncating the message
      const pad = new Array(targetBytes - bytes.length).fill(0);
      bytes = bytes.concat(pad);
    } else if (bytes.length > targetBytes) {
      bytes = bytes.slice(0, targetBytes);
    }
  }

  return bytes;
}

// ================= Geometry: row positions along the strip =================
// The strip is modeled as a straight run of rows along its own long axis (the
// "unrolled" length), then rendered rotated by DIAGONAL_DEG for the reference
// look. Physical pitch is computed along the unrolled axis so real-world
// hole spacing is exact regardless of the on-screen rotation.

function totalTapeLengthMM(numBytes) {
  return numBytes * BYTE_ROWS * ROW_PITCH_MM;
}

// ================= SVG helpers =================

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

// Draw the tape strip (a rotated rectangle) with rows of clock+data holes,
// clipped to [rowStart, rowEnd) (row indices, global across the whole tape),
// into an SVG sized to one physical sheet. Returns the SVG element.
//
// The strip is drawn diagonally the way the reference PDF does it, wrapping
// top-to-bottom in a boustrophedon (serpentine) path down the page so a long
// tape fits on a normal sheet: each "swing" covers a fixed number of rows,
// then folds back, with a SAVE fold+cut mark at each byte boundary swing end.

function renderSheetSVG(opts) {
  const {
    sheetWmm, sheetHmm, marginMm,
    rows,           // array of {bit: 0/1, isClock:false} pairs already resolved to draw list: [{clock:1,data:0/1, byteIndex, rowInByte}]
    sheetIndex, totalSheets,
    isFirstSheet, isLastSheet,
    joinMode,
    leadOverlapRows, // number of overlap rows repeated at top of this sheet (0 for first sheet or butt join)
  } = opts;

  const svg = svgEl("svg", {
    class: "sheet",
    width: mmToPx(sheetWmm),
    height: mmToPx(sheetHmm),
    viewBox: `0 0 ${sheetWmm} ${sheetHmm}`,
    xmlns: SVG_NS
  });

  // background
  svg.appendChild(svgEl("rect", {
    x: 0, y: 0, width: sheetWmm, height: sheetHmm, fill: "#ffffff"
  }));

  const usableW = sheetWmm - marginMm * 2;
  const usableH = sheetHmm - marginMm * 2;

  // Serpentine layout: strip runs left-to-right across usableW, drops down
  // by TAPE_WIDTH_MM + gap, reverses direction, repeats.
  const laneGap = 6; // mm between serpentine lanes
  const laneHeight = TAPE_WIDTH_MM + laneGap;
  const numLanes = Math.max(1, Math.floor((usableH + laneGap) / laneHeight));

  // How many rows fit per lane, along the row pitch
  const rowsPerLane = Math.max(1, Math.floor(usableW / ROW_PITCH_MM));

  const g = svgEl("g", { transform: `translate(${marginMm}, ${marginMm})` });
  svg.appendChild(g);

  let rowCursor = 0;
  let laneIndex = 0;

  while (rowCursor < rows.length && laneIndex < numLanes) {
    const laneRows = rows.slice(rowCursor, rowCursor + rowsPerLane);
    const reverse = laneIndex % 2 === 1;
    const laneY = laneIndex * laneHeight;

    drawLane(g, laneRows, laneY, usableW, reverse, rowCursor, joinMode, leadOverlapRows, isFirstSheet);

    rowCursor += laneRows.length;
    laneIndex++;
  }

  // sheet footer label
  const label = svgEl("text", {
    x: marginMm, y: sheetHmm - marginMm / 2.2,
    "font-size": 3.2, "font-family": "monospace", fill: "#8a8578"
  });
  label.textContent = `sheet ${sheetIndex + 1} of ${totalSheets} — print at 100% / actual size — 25mm tape`;
  svg.appendChild(label);

  return svg;
}

function drawLane(g, laneRows, laneY, usableW, reverse, globalRowStart, joinMode, leadOverlapRows, isFirstSheet) {
  const laneG = svgEl("g", { transform: `translate(0, ${laneY})` });
  g.appendChild(laneG);

  // tape background band
  laneG.appendChild(svgEl("rect", {
    x: 0, y: 0, width: usableW, height: TAPE_WIDTH_MM,
    fill: "#E8A33D", stroke: "#8a5a12", "stroke-width": 0.3
  }));

  const n = laneRows.length;
  for (let i = 0; i < n; i++) {
    const rowData = laneRows[i];
    const visualIndex = reverse ? (n - 1 - i) : i;
    const x = visualIndex * ROW_PITCH_MM + ROW_PITCH_MM / 2;

    const isOverlapRow = (isFirstSheet === false) && (globalRowStart + i) < leadOverlapRows;

    drawRow(laneG, x, rowData, isOverlapRow, joinMode);

    // byte boundary cut/fold marker: after the 8th row of a byte (rowInByte === 7)
    if (rowData.rowInByte === BYTE_ROWS - 1) {
      const cutX = x + ROW_PITCH_MM / 2;
      drawCutMark(laneG, cutX, joinMode, rowData.isJoinCut);
    }
  }
}

function drawRow(laneG, x, rowData, isOverlapRow, joinMode) {
  const opacity = isOverlapRow ? 0.38 : 1.0;
  const rowG = svgEl("g", { opacity: opacity });
  laneG.appendChild(rowG);

  // The circle is the ONLY real hole in the paper — the clock/sprocket
  // track that physically drives the reader, punched on every single row
  // regardless of data value. This second circle is not a hole at all: it's a
  // blank cell a human fills in by hand with ink to write a data bit.
  // Filled in (solid) = 1. Left blank = 0.
  //
  // The clock hole is staggered half a hole-width ahead of its row's data
  // cell, along the direction the tape feeds through the reader (increasing
  // x = further along, fed later). This guarantees the clock contact always
  // reaches a row before the data contact does, and the two are never both
  // sitting over an active feature at the same instant.
  const clockX = x - CLOCK_LEAD_MM / 2;
  const dataX  = x + CLOCK_LEAD_MM / 2;
  const clockY = CLOCK_INSET_MM;
  const dataY = TAPE_WIDTH_MM - DATA_INSET_MM;
  const r = HOLE_DIAM_MM / 2;

  // clock hole: always punched, every row, no matter the data value —
  // always the leading (first-reached) feature of the pair
  rowG.appendChild(svgEl("circle", {
    cx: clockX, cy: clockY, r: r,
    fill: "#1B1D22"
  }));

  // data cell: a circle to write in by hand, not a hole —
  // always trailing the clock hole by half a hole-width
  if (rowData.bit === 1) {
    // pre-filled to show a "1" — printed solid, as if already inked
    rowG.appendChild(svgEl("circle", {
      cx: dataX, cy: dataY, r: r,
      fill: "#1B1D22", stroke: "#1B1D22", "stroke-width": 0.25
    }));
  } else {
    // blank cell for a "0" — just the outline, left empty for the tape
    // to read as 0 (or for a human to leave un-inked)
    rowG.appendChild(svgEl("circle", {
      cx: dataX, cy: dataY, r: r,
      fill: "none", stroke: "#8a5a12", "stroke-width": 0.35
    }));
  }

  if (isOverlapRow) {
    rowG.setAttribute("data-overlap", "true");
  }
}

function drawCutMark(laneG, x, joinMode, isJoinCut) {
  const color = isJoinCut ? "#C2452D" : "#c9c2ac";
  const dash = isJoinCut ? "none" : "1.2,1.2";
  laneG.appendChild(svgEl("line", {
    x1: x, y1: -2.5, x2: x, y2: TAPE_WIDTH_MM + 2.5,
    stroke: color, "stroke-width": isJoinCut ? 0.5 : 0.3,
    "stroke-dasharray": dash
  }));
  if (isJoinCut) {
    const label = svgEl("text", {
      x: x + 0.8, y: -3.2, "font-size": 2.2, "font-family": "monospace", fill: "#C2452D"
    });
    label.textContent = joinMode === "overlap" ? "glue here \u2192" : "cut / join \u2192";
    laneG.appendChild(label);
  }
}

function mmToPx(mm) {
  // screen preview scale — not used for print (print uses physical mm via viewBox + CSS size)
  return mm * 3.7795275591 * state.zoom; // 96dpi baseline * zoom
}

// ================= Row list construction =================

function buildRowList(bytes) {
  const rows = [];
  bytes.forEach((byte, byteIndex) => {
    const bits = byteToBits(byte);
    bits.forEach((bit, rowInByte) => {
      rows.push({ bit, byteIndex, rowInByte });
    });
  });
  return rows;
}

// ================= Sheet splitting =================
// Splits the full row list into per-sheet chunks, guaranteeing every sheet
// boundary sits on a byte edge (rowInByte === 7 is the last row of a byte),
// and — for overlap join mode — repeating the final byte of each sheet as
// the first (dimmed) byte of the next sheet, so gluing that repeated byte
// over its printed twin keeps pitch continuous with zero gap.

function splitIntoSheets(rows, paper, marginMm, joinMode) {
  const usableW = paper.w - marginMm * 2;
  const usableH = paper.h - marginMm * 2;
  const laneGap = 6;
  const laneHeight = TAPE_WIDTH_MM + laneGap;
  const numLanes = Math.max(1, Math.floor((usableH + laneGap) / laneHeight));
  const rowsPerLane = Math.max(1, Math.floor(usableW / ROW_PITCH_MM));

  // rows per lane must be a multiple of BYTE_ROWS so lanes themselves don't
  // split a byte across the serpentine fold
  const rowsPerLaneAligned = Math.max(BYTE_ROWS, Math.floor(rowsPerLane / BYTE_ROWS) * BYTE_ROWS);
  const rowsPerSheet = rowsPerLaneAligned * numLanes;

  const sheets = [];
  let cursor = 0;
  const overlapRows = joinMode === "overlap" ? BYTE_ROWS : 0;

  while (cursor < rows.length) {
    let sheetRows;
    let freshCount;

    if (sheets.length === 0) {
      sheetRows = rows.slice(cursor, cursor + rowsPerSheet);
      freshCount = sheetRows.length;
    } else {
      // repeat the overlap tail from the previous sheet's *source* position,
      // i.e. re-take the last BYTE_ROWS rows already consumed
      const overlapSource = rows.slice(Math.max(0, cursor - overlapRows), cursor);
      freshCount = Math.max(0, rowsPerSheet - overlapSource.length);
      const fresh = rows.slice(cursor, cursor + freshCount);
      sheetRows = overlapSource.concat(fresh);
      freshCount = fresh.length;
    }

    // Safety: if nothing new got consumed (degenerate config), bail to avoid
    // an infinite loop rather than hanging the page.
    if (freshCount <= 0 && sheets.length > 0) break;

    cursor += freshCount;

    // mark the join-cut row (last row of the last full byte on this sheet,
    // unless it's genuinely the final byte of the whole tape)
    const isLastSheetForThisChunk = cursor >= rows.length;
    if (!isLastSheetForThisChunk) {
      for (let i = sheetRows.length - 1; i >= 0; i--) {
        if (sheetRows[i].rowInByte === BYTE_ROWS - 1) {
          sheetRows[i] = Object.assign({}, sheetRows[i], { isJoinCut: true });
          break;
        }
      }
    }

    sheets.push({
      rows: sheetRows,
      rowsPerLane: rowsPerLaneAligned,
      numLanes,
      leadOverlapRows: sheets.length === 0 ? 0 : overlapRows
    });
  }

  return sheets;
}

// ================= Rendering orchestration =================

function rebuild() {
  const bytes = buildByteSequence();
  state.bytes = bytes;

  const paperKey = document.getElementById("paper-size").value;
  const paper = PAPER[paperKey];
  const marginMm = parseFloat(document.getElementById("sheet-margin").value) || 12;
  const joinMode = document.querySelector('input[name="joinmode"]:checked').value;

  const rows = buildRowList(bytes);
  const sheetsData = rows.length > 0 ? splitIntoSheets(rows, paper, marginMm, joinMode) : [];

  // ---- render screen preview ----
  const container = document.getElementById("sheets");
  container.innerHTML = "";

  sheetsData.forEach((sheetData, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "sheet-wrap";

    const lbl = document.createElement("div");
    lbl.className = "sheet-label";
    lbl.textContent = `Sheet ${idx + 1} / ${sheetsData.length}`;
    wrap.appendChild(lbl);

    const svg = renderSheetSVG({
      sheetWmm: paper.w, sheetHmm: paper.h, marginMm,
      rows: sheetData.rows,
      sheetIndex: idx, totalSheets: sheetsData.length,
      isFirstSheet: idx === 0, isLastSheet: idx === sheetsData.length - 1,
      joinMode, leadOverlapRows: sheetData.leadOverlapRows
    });
    wrap.appendChild(svg);
    container.appendChild(wrap);
  });

  // ---- render print copy (physical mm sizing, one per page) ----
  const printRoot = document.getElementById("print-root");
  printRoot.innerHTML = "";
  sheetsData.forEach((sheetData, idx) => {
    const page = document.createElement("div");
    page.className = "print-page";
    const svg = renderSheetSVG({
      sheetWmm: paper.w, sheetHmm: paper.h, marginMm,
      rows: sheetData.rows,
      sheetIndex: idx, totalSheets: sheetsData.length,
      isFirstSheet: idx === 0, isLastSheet: idx === sheetsData.length - 1,
      joinMode, leadOverlapRows: sheetData.leadOverlapRows
    });
    // physical size for print: 1mm = 1mm via CSS using mm units directly
    svg.setAttribute("width", `${paper.w}mm`);
    svg.setAttribute("height", `${paper.h}mm`);
    page.appendChild(svg);
    printRoot.appendChild(page);
  });

  // ---- stats ----
  document.getElementById("stat-bytes").textContent = bytes.length;
  const lenMm = totalTapeLengthMM(bytes.length);
  document.getElementById("stat-length").textContent =
    lenMm >= 1000 ? `${(lenMm / 1000).toFixed(2)} m` : `${lenMm.toFixed(0)} mm`;
  document.getElementById("stat-sheets").textContent = sheetsData.length;
}

// ================= UI wiring =================

function setupUI() {
  const modeRadios = document.querySelectorAll('input[name="mode"]');
  const textField = document.getElementById("text-field");
  const hexField = document.getElementById("hex-field");
  const patternField = document.getElementById("pattern-field");

  function syncModeFields() {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    textField.style.display = mode === "text" ? "" : "none";
    hexField.style.display = mode === "bytes" ? "" : "none";
    patternField.style.display = mode === "pattern" ? "" : "none";
  }
  modeRadios.forEach(r => r.addEventListener("change", syncModeFields));
  syncModeFields();

  const lenRadios = document.querySelectorAll('input[name="lenmode"]');
  const fixedLenField = document.getElementById("fixed-len-field");
  function syncLenFields() {
    const mode = document.querySelector('input[name="lenmode"]:checked').value;
    fixedLenField.style.display = mode === "fixed" ? "" : "none";
  }
  lenRadios.forEach(r => r.addEventListener("change", syncLenFields));
  syncLenFields();

  document.getElementById("build-btn").addEventListener("click", rebuild);
  document.getElementById("print-btn").addEventListener("click", () => window.print());

  document.getElementById("zoom-in").addEventListener("click", () => {
    state.zoom = Math.min(2.5, state.zoom + 0.15);
    rebuild();
  });
  document.getElementById("zoom-out").addEventListener("click", () => {
    state.zoom = Math.max(0.3, state.zoom - 0.15);
    rebuild();
  });

  // live-ish rebuild on key field changes (not on every keystroke of text to
  // avoid thrashing while typing a long message — rebuild button covers that)
  ["paper-size", "sheet-margin", "fixed-length", "fixed-length-unit",
   "pattern-byte", "pattern-count"].forEach(id => {
    document.getElementById(id).addEventListener("change", rebuild);
  });
  document.querySelectorAll('input[name="joinmode"]').forEach(r => r.addEventListener("change", rebuild));
}

document.addEventListener("DOMContentLoaded", () => {
  setupUI();
  rebuild();
});
