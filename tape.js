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
//   circle diameter (the only real hole)            ≈ 68.2 px → 5.77 mm
//   data circle size (hand-inked, same size)        ≈ 68.2 px → 5.77 mm
//   clock-track inset from its edge                 ≈ 74.4 px → 6.30 mm
//   data-track inset from its (opposite) edge       ≈ 70.9 px → 6.00 mm
//
// ROW_PITCH_MM is NOT the reference PDF's measured 6.06mm. That measured
// pitch assumed clock and data sat at the same along-axis position with no
// stagger. Once a half-hole-width stagger was added (CLOCK_LEAD_MM below)
// so the clock and data circles are never simultaneously "active", the
// reference pitch became too tight: adjacent rows' circles would overlap
// and spill past the tape's own printed edges. The pitch below is widened
// just enough to fit the full stagger with a small safety gap, so every
// circle stays fully inside its own row slot with no collisions.
const TAPE_WIDTH_MM     = 25.0;   // strip width, matches reference PDF
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

// Row pitch: wide enough that row N's data circle and row N+1's clock
// circle never touch, given the stagger above. Minimum safe value is
// CLOCK_LEAD_MM + HOLE_DIAM_MM (≈ 8.655mm); +0.5mm adds visible daylight
// between adjacent circles rather than leaving them just barely touching.
const ROW_PITCH_MM      = CLOCK_LEAD_MM + HOLE_DIAM_MM + 0.5;  // ≈ 9.155 mm

// Leader/trailer buffer: a plain, feature-free length of tape at the very
// start and very end of the WHOLE tape (once each — not repeated per sheet
// or per lane). This gives a feed mechanism, roller, or fingers something
// solid to grip before the first real clock pulse and after the last one,
// so the reader's contacts never ride onto — or off of — the strip
// mid-hole. Drawn as solid tape with no holes, labeled once with which
// track is clock and which is data so the strip can't be fed in backwards.
const BUFFER_LENGTH_MM     = 30;   // plain feed length at each end of the tape
const BUFFER_LABEL_SIZE_MM = 2.6;  // font size for the CLOCK/DATA buffer labels

// Lane glue zone: a plain, blank stretch of tape (no holes) inserted at
// EVERY lane-to-lane fold within a sheet — not just the very start/end of
// the whole tape. When a printed sheet gets cut apart at each fold and the
// resulting strips are joined back into one continuous tape, this is the
// blank material you actually glue or tape the overlapping ends onto.
// Adjustable by the user (mm input in the UI) since how much overlap
// material is comfortable depends on the person's glue/tape and how
// precisely they can align two cut edges by hand.
let LANE_GLUE_MM = 15;  // default length of blank tape reserved at each lane fold

// Optional pairing labels ("1A"/"1B", "2A"/"2B", ...) printed on each fold's
// two glue-zone halves so a person reassembling cut strips can match sides
// by text instead of by counting rows. On by default; toggleable since not
// everyone wants the extra print clutter.
let SHOW_FOLD_LABELS = true;

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

// ================= Shared lane-planning logic =================
// Used by BOTH renderSheetSVG (to actually draw lanes) and splitIntoSheets
// (to know how many rows fit on a sheet before it draws anything). Having
// one function compute lane capacities and plan lane boundaries guarantees
// the two can never disagree about how many rows fit where — a previous
// version had each recompute this independently, which is exactly the kind
// of duplication that let subtle mismatches slip in.

function laneCapacities(usableW) {
  const rowsPerLaneFirstOnlyRaw = Math.max(1, Math.floor((usableW - BUFFER_LENGTH_MM - LANE_GLUE_MM) / ROW_PITCH_MM));
  const rowsPerLaneFirstOnly = Math.max(BYTE_ROWS, Math.floor(rowsPerLaneFirstOnlyRaw / BYTE_ROWS) * BYTE_ROWS);
  const rowsPerLaneMiddleRaw = Math.max(1, Math.floor((usableW - LANE_GLUE_MM * 2) / ROW_PITCH_MM));
  const rowsPerLaneMiddle = Math.max(BYTE_ROWS, Math.floor(rowsPerLaneMiddleRaw / BYTE_ROWS) * BYTE_ROWS);
  const rowsPerLaneLastOnlyRaw = Math.max(1, Math.floor((usableW - BUFFER_LENGTH_MM - LANE_GLUE_MM) / ROW_PITCH_MM));
  const rowsPerLaneLastOnly = Math.max(BYTE_ROWS, Math.floor(rowsPerLaneLastOnlyRaw / BYTE_ROWS) * BYTE_ROWS);
  const rowsPerLaneWithBothRaw = Math.max(1, Math.floor((usableW - BUFFER_LENGTH_MM * 2) / ROW_PITCH_MM));
  const rowsPerLaneWithBoth = Math.max(BYTE_ROWS, Math.floor(rowsPerLaneWithBothRaw / BYTE_ROWS) * BYTE_ROWS);
  return { rowsPerLaneFirstOnly, rowsPerLaneMiddle, rowsPerLaneLastOnly, rowsPerLaneWithBoth };
}

// Plans how a sheet's row array divides into lanes, given the sheet's
// geometry and whether this is the first/last sheet of the whole tape.
// Returns an array of { rowCount, isVeryFirstLane, isVeryLastLane,
// needsGlueZone } describing each lane in drawing order, WITHOUT actually
// slicing the row array — callers slice using rowCount themselves.
//
// Lane capacity depends on which blank zones a lane needs to reserve
// space for:
//   - lane 0 (very first, not also last): [leader][content][glue]
//   - a middle lane (not first, not last): [receiving][content][glue]
//   - the very last lane (not also first): [receiving][content][trailer]
//   - both-buffers lane (first AND last, tiny tape): [leader][content][trailer]
// The "receiving" zone matches the previous lane's trailing glue zone —
// without it, the previous strip's glued overlap would land on top of
// this lane's real content instead of on blank tape meant to receive it.
// Row counts are rounded DOWN to a multiple of BYTE_ROWS so a lane fold
// never lands mid-byte.
function planLanes(totalRowsAvailable, usableW, usableH, isFirstSheet, isLastSheet) {
  const laneGap = 6;
  const laneHeight = TAPE_WIDTH_MM + laneGap;
  const numLanes = Math.max(1, Math.floor((usableH + laneGap) / laneHeight));
  const cap = laneCapacities(usableW);

  const lanes = [];
  let rowCursor = 0;
  let laneIndex = 0;

  while (rowCursor < totalRowsAvailable && laneIndex < numLanes) {
    const isVeryFirstLane = isFirstSheet && laneIndex === 0;
    const remaining = totalRowsAvailable - rowCursor;

    // If this is the very first lane AND all remaining rows would fit
    // within the leader-reduced capacity, the trailer will ALSO land in
    // this lane — so use the doubly-reduced capacity instead.
    const bothBuffersApply = isVeryFirstLane && isLastSheet && remaining <= cap.rowsPerLaneFirstOnly;

    // For a non-first lane, we don't yet know if it's also the very last
    // lane until we check how much remains: if the remaining rows fit
    // within the "last lane" capacity (receiving zone + content + trailer,
    // no trailing glue needed), this IS the last lane. Otherwise it's a
    // middle lane needing both a receiving zone AND its own trailing glue
    // zone, so use the smaller middle-lane capacity.
    const isLastLaneCandidate = !isVeryFirstLane && isLastSheet && remaining <= cap.rowsPerLaneLastOnly;

    const rowsPerLane = bothBuffersApply ? cap.rowsPerLaneWithBoth
                       : isVeryFirstLane ? cap.rowsPerLaneFirstOnly
                       : isLastLaneCandidate ? cap.rowsPerLaneLastOnly
                       : cap.rowsPerLaneMiddle;
    const rowCount = Math.min(rowsPerLane, remaining);
    const isVeryLastLane = isLastSheet && (rowCursor + rowCount >= totalRowsAvailable);
    const needsGlueZone = !isVeryLastLane;

    lanes.push({ rowCount, isVeryFirstLane, isVeryLastLane, needsGlueZone });

    rowCursor += rowCount;
    laneIndex++;
  }

  return { lanes, numLanes };
}

// How many folds (lane-to-lane glue joins) a sheet with this many rows and
// this geometry would open. Used to compute the correct starting fold
// number for a later sheet WITHOUT actually rendering the sheets before
// it — needed because the screen preview only renders one page of sheets
// at a time (see renderPreviewPage), but fold numbers must stay continuous
// across the whole tape regardless of which page is currently shown.
function countFoldsInSheet(totalRowsAvailable, usableW, usableH, isFirstSheet, isLastSheet) {
  const { lanes } = planLanes(totalRowsAvailable, usableW, usableH, isFirstSheet, isLastSheet);
  return lanes.reduce((count, lane) => count + ((lane.needsGlueZone && !lane.isVeryLastLane) ? 1 : 0), 0);
}

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

  const { lanes } = planLanes(rows.length, usableW, usableH, isFirstSheet, isLastSheet);

  const g = svgEl("g", { transform: `translate(${marginMm}, ${marginMm})` });
  svg.appendChild(g);

  let rowCursor = 0;
  // Fold numbering must be continuous across the WHOLE tape, not reset per
  // sheet, so a person gluing sheet 3's strips can still tell which piece
  // continues from sheet 2. foldNumberStart is passed in by the caller
  // (which tracks the running total across all sheets); each lane that
  // opens a new fold (i.e. has a trailing glue zone) consumes one number.
  let foldNumber = opts.foldNumberStart || 1;

  lanes.forEach((lanePlan, laneIndex) => {
    const laneRows = rows.slice(rowCursor, rowCursor + lanePlan.rowCount);
    // Every lane always reads left-to-right: row 0 (chronologically first)
    // at the left edge, the last row at the right edge. No alternating
    // serpentine direction — that zigzag made adjacent lanes' start/end
    // sides swap every other row, which reads as inconsistent even though
    // it was a deliberate boustrophedon layout. The bit order itself is
    // unaffected either way, since it comes from array position, not
    // drawing direction.
    const reverse = false;
    const laneY = laneIndex * laneHeight;

    // This lane's own trailing glue zone (if any) is fold `foldNumber`,
    // labeled "<n>A". The NEXT lane's receiving zone is the other half of
    // that same fold, labeled "<n>B" — so the receiving-zone label a lane
    // draws at its own start is always foldNumber - 1 (the fold opened by
    // the PREVIOUS lane), never the current lane's own fold number.
    const trailingFoldLabel = (SHOW_FOLD_LABELS && lanePlan.needsGlueZone && !lanePlan.isVeryLastLane) ? `${foldNumber}A` : null;
    const receivingFoldLabel = (SHOW_FOLD_LABELS && !lanePlan.isVeryFirstLane) ? `${foldNumber - 1}B` : null;

    drawLane(g, laneRows, laneY, usableW, reverse, rowCursor, joinMode, leadOverlapRows,
             isFirstSheet, lanePlan.isVeryFirstLane, lanePlan.isVeryLastLane, lanePlan.needsGlueZone,
             trailingFoldLabel, receivingFoldLabel);

    // Fold count must keep advancing even when labels are hidden, so that
    // re-enabling the toggle later (or a later sheet's receiving label)
    // still lines up correctly — increment on the underlying condition,
    // not on whether a label string was actually produced.
    if (lanePlan.needsGlueZone && !lanePlan.isVeryLastLane) foldNumber++;

    rowCursor += laneRows.length;
  });

  // sheet footer label
  const label = svgEl("text", {
    x: marginMm, y: sheetHmm - marginMm / 2.2,
    "font-size": 3.2, "font-family": "monospace", fill: "#8a8578"
  });
  label.textContent = `sheet ${sheetIndex + 1} of ${totalSheets} — print at 100% / actual size — 25mm tape`;
  svg.appendChild(label);

  // Stashed rather than returned separately so existing callers that treat
  // this function as "returns an SVG element" keep working unchanged; the
  // next sheet's renderSheetSVG call reads this off the previous call's
  // return value to keep fold numbering continuous across sheets.
  svg._nextFoldNumber = foldNumber;

  return svg;
}

function drawLane(g, laneRows, laneY, usableW, reverse, globalRowStart, joinMode, leadOverlapRows,
                   isFirstSheet, isVeryFirstLane, isVeryLastLane, needsGlueZone,
                   trailingFoldLabel, receivingFoldLabel) {
  const laneG = svgEl("g", { transform: `translate(0, ${laneY})` });
  g.appendChild(laneG);

  const leaderWidth = isVeryFirstLane ? BUFFER_LENGTH_MM : 0;
  const trailerWidth = isVeryLastLane ? BUFFER_LENGTH_MM : 0;
  // A glue zone is blank tape appended after this lane's content, reserved
  // for gluing/taping the next lane's start onto once the sheet is cut
  // apart at this fold. It never coexists with a trailer — the very last
  // lane of the whole tape gets a trailer (or nothing) instead, since
  // there's no "next lane" to join to there.
  const glueWidth = (needsGlueZone && !isVeryLastLane) ? LANE_GLUE_MM : 0;
  // Every lane EXCEPT the very first one needs a matching RECEIVING zone
  // at its own start — blank tape the same length as the previous lane's
  // trailing glue zone. Without this, the previous strip's glued overlap
  // would land on top of this lane's real clock/data content (or its
  // trailer), instead of on blank tape meant to receive it.
  const receivingWidth = isVeryFirstLane ? 0 : LANE_GLUE_MM;
  const n = laneRows.length;
  const contentWidth = n * ROW_PITCH_MM;

  // The lane only needs to be as wide as what it actually contains —
  // leader or receiving zone (if any) + real row content + glue zone or
  // trailer (if any) — not the full sheet-wide usableW. Drawing the
  // background rect at usableW regardless of how many rows landed in this
  // lane left a stretch of blank, functionally meaningless tape hanging
  // off the end of every partially-filled lane, which is wasted paper and
  // confusing to cut around.
  const actualLaneWidth = leaderWidth + receivingWidth + contentWidth + glueWidth + trailerWidth;

  // tape background band — sized to exactly what this lane holds
  laneG.appendChild(svgEl("rect", {
    x: 0, y: 0, width: actualLaneWidth, height: TAPE_WIDTH_MM,
    fill: "#E8A33D", stroke: "#8a5a12", "stroke-width": 0.3
  }));

  // Row i=0 is always the chronologically-first row (the one the reader
  // meets earliest). In a normal lane it's drawn on the left; in a
  // reversed (serpentine fold-back) lane it's drawn on the right instead.
  // The leader/receiving zone must sit before row i=0 in READING order,
  // and the trailer/glue zone must sit after row i=(n-1) in reading order
  // — so all of these need to flip sides along with the lane's own
  // direction.
  //
  // Positions are anchored to actualLaneWidth (this lane's own real
  // width), not the sheet-wide usableW, so a reversed lane's content sits
  // flush against this lane's own right edge rather than the full sheet
  // width regardless of how short the lane's content is.
  const leadingZoneWidth = leaderWidth + receivingWidth; // exactly one of these is ever nonzero
  const leadingZonePageX = reverse ? (actualLaneWidth - leadingZoneWidth) : 0;
  const trailingZonePageX = reverse ? 0 : (leadingZoneWidth + contentWidth);
  const rowOriginOffset = reverse ? (actualLaneWidth - leadingZoneWidth - contentWidth) : leadingZoneWidth;

  if (isVeryFirstLane) {
    drawBuffer(laneG, leadingZonePageX, leaderWidth, reverse, "leader");
  } else if (receivingWidth > 0) {
    drawGlueZone(laneG, leadingZonePageX, receivingWidth, reverse, receivingFoldLabel);
  }

  for (let i = 0; i < n; i++) {
    const rowData = laneRows[i];
    // visualIndex counts rows in PAGE-DRAWING order (left to right); when
    // reverse, row i=0 (chronologically first) lands at the rightmost
    // content slot, i.e. the highest visualIndex
    const visualIndex = reverse ? (n - 1 - i) : i;
    const x = rowOriginOffset + visualIndex * ROW_PITCH_MM + ROW_PITCH_MM / 2;

    const isOverlapRow = (isFirstSheet === false) && (globalRowStart + i) < leadOverlapRows;

    drawRow(laneG, x, rowData, isOverlapRow, joinMode);

    // byte boundary cut/fold marker: after the 8th row of a byte (rowInByte === 7)
    if (rowData.rowInByte === BYTE_ROWS - 1) {
      const cutX = x + ROW_PITCH_MM / 2;
      drawCutMark(laneG, cutX, joinMode, rowData.isJoinCut);
    }
  }

  if (isVeryLastLane) {
    drawBuffer(laneG, trailingZonePageX, trailerWidth, reverse, "trailer");
  } else if (glueWidth > 0) {
    drawGlueZone(laneG, trailingZonePageX, glueWidth, reverse, trailingFoldLabel);
  }
}

// Draws a plain, feature-free stretch of tape (no clock hole, no data
// circle) at a lane-to-lane fold — the blank material you glue or tape
// the next lane's start onto once the sheet is cut apart at this fold.
// Unlike the leader/trailer buffer, this repeats at every fold and carries
// no CLOCK/DATA labels (it's a mechanical join aid, not a feed/orientation
// aid).
//
// foldLabel, when provided (e.g. "3A" or "3B"), is an optional pairing aid
// so a person gluing strips back together can match sides by text instead
// of by counting rows: both halves of fold #3 print "3", with "A" marking
// the trailing (glue-onto-this) side and "B" marking the receiving
// (glue-this-onto) side of the SAME fold. Falls back to the plain "glue"
// label when no pairing number is given.
function drawGlueZone(laneG, startX, widthMm, reverse, foldLabel) {
  if (widthMm <= 0) return;

  const zoneG = svgEl("g", {});
  laneG.appendChild(zoneG);

  // dashed divider marking where real data ends and the glue zone begins
  zoneG.appendChild(svgEl("line", {
    x1: startX, y1: 0, x2: startX, y2: TAPE_WIDTH_MM,
    stroke: "#8a5a12", "stroke-width": 0.25, "stroke-dasharray": "1,1"
  }));

  const textX = startX + widthMm / 2;
  const label = svgEl("text", {
    x: textX, y: TAPE_WIDTH_MM / 2 + 1,
    "font-size": 2.3, "font-family": "monospace", fill: "#8a5a12", "text-anchor": "middle"
  });
  label.textContent = foldLabel ? `glue ${foldLabel}` : "glue";
  zoneG.appendChild(label);
}

// Draws a plain, feature-free stretch of tape (no clock hole, no data
// circle) used as a leader (before the first real row) or trailer (after
// the last real row) so a feed mechanism always grips solid tape, never a
// hole. Also stamps the CLOCK/DATA track labels once, so the strip can't
// be fed in backwards or upside down.
function drawBuffer(laneG, startX, widthMm, reverse, kind) {
  if (widthMm <= 0) return;

  const bufG = svgEl("g", {});
  laneG.appendChild(bufG);

  // subtle inner line marking where the buffer ends and real data begins,
  // so it reads clearly as "feed zone" rather than looking like a mistake
  const dividerX = kind === "leader" ? startX + widthMm : startX;
  bufG.appendChild(svgEl("line", {
    x1: dividerX, y1: 0, x2: dividerX, y2: TAPE_WIDTH_MM,
    stroke: "#8a5a12", "stroke-width": 0.25, "stroke-dasharray": "1,1"
  }));

  const clockY = CLOCK_INSET_MM;
  const dataY = TAPE_WIDTH_MM - DATA_INSET_MM;

  // Label placement: text runs along the tape, positioned so it reads
  // correctly regardless of which lane direction this buffer landed in.
  const textX = startX + widthMm / 2;
  const anchor = "middle";

  const clockLabel = svgEl("text", {
    x: textX, y: clockY + BUFFER_LABEL_SIZE_MM * 0.32,
    "font-size": BUFFER_LABEL_SIZE_MM, "font-family": "monospace",
    "font-weight": "bold", fill: "#1B1D22", "text-anchor": anchor
  });
  clockLabel.textContent = "CLOCK";
  bufG.appendChild(clockLabel);

  const dataLabel = svgEl("text", {
    x: textX, y: dataY + BUFFER_LABEL_SIZE_MM * 0.32,
    "font-size": BUFFER_LABEL_SIZE_MM, "font-family": "monospace",
    "font-weight": "bold", fill: "#1B1D22", "text-anchor": anchor
  });
  dataLabel.textContent = "DATA";
  bufG.appendChild(dataLabel);

  // small arrow indicating feed direction (into the reader), pointing from
  // the buffer toward the real holes
  const arrowDir = kind === "leader" ? 1 : -1;
  const arrowBaseX = kind === "leader" ? startX + widthMm * 0.78 : startX + widthMm * 0.22;
  const arrowY = TAPE_WIDTH_MM / 2;
  const arrowLen = 3.2;
  bufG.appendChild(svgEl("line", {
    x1: arrowBaseX, y1: arrowY, x2: arrowBaseX + arrowLen * arrowDir, y2: arrowY,
    stroke: "#1B1D22", "stroke-width": 0.4
  }));
  bufG.appendChild(svgEl("polygon", {
    points: `${arrowBaseX + arrowLen*arrowDir},${arrowY} ${arrowBaseX + (arrowLen-1.1)*arrowDir},${arrowY-0.9} ${arrowBaseX + (arrowLen-1.1)*arrowDir},${arrowY+0.9}`,
    fill: "#1B1D22"
  }));

  const kindLabel = svgEl("text", {
    x: textX, y: TAPE_WIDTH_MM + 3.6,
    "font-size": 2.1, "font-family": "monospace", fill: "#8a8578", "text-anchor": anchor
  });
  kindLabel.textContent = kind === "leader" ? "feed leader — no data" : "feed trailer — no data";
  bufG.appendChild(kindLabel);
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
//
// Sheet capacity is derived from planLanes (the same lane-planning logic
// renderSheetSVG uses), by summing how many rows fit across that sheet's
// lanes — so the two can never disagree about how many rows land where.
//
// sheetPhysicalCapacity answers "how many total row-slots does a sheet
// with this geometry have, independent of how much content exists?" — it
// passes an effectively-unlimited totalRowsAvailable into planLanes so the
// content amount never clamps the result; the returned number is a
// property of the PAPER, not of any particular message.

function sheetPhysicalCapacity(usableW, usableH, isFirstSheet, isLastSheet) {
  const effectivelyUnlimited = 1000000;
  const { lanes } = planLanes(effectivelyUnlimited, usableW, usableH, isFirstSheet, isLastSheet);
  return lanes.reduce((sum, lane) => sum + lane.rowCount, 0);
}

function splitIntoSheets(rows, paper, marginMm, joinMode) {
  const usableW = paper.w - marginMm * 2;
  const usableH = paper.h - marginMm * 2;

  const sheets = [];
  let cursor = 0;
  const overlapRows = joinMode === "overlap" ? BYTE_ROWS : 0;

  while (cursor < rows.length) {
    let sheetRows;
    let freshCount;
    const isVeryFirstSheet = sheets.length === 0;
    const remainingRows = rows.length - cursor;
    // How many of this sheet's slots get consumed by repeating the
    // previous sheet's overlap tail rather than fresh content (0 for the
    // very first sheet, which has no previous sheet to repeat from).
    const overlapSourceLen = isVeryFirstSheet ? 0 : Math.min(overlapRows, cursor);

    // A sheet's physical capacity (total row-slots) is fixed by its
    // geometry, independent of the message — compute it once for both
    // hypotheses ("this is the last sheet" vs "the tape continues past
    // it"), then see how many FRESH rows that leaves room for once the
    // repeated overlap tail's slots are subtracted.
    const physicalCapacityIfLast = sheetPhysicalCapacity(usableW, usableH, isVeryFirstSheet, true);
    const freshCapacityIfLast = physicalCapacityIfLast - overlapSourceLen;
    const isThisSheetLast = remainingRows <= freshCapacityIfLast;

    const capacityForThisSheet = isThisSheetLast
      ? physicalCapacityIfLast
      : sheetPhysicalCapacity(usableW, usableH, isVeryFirstSheet, false);

    if (isVeryFirstSheet) {
      sheetRows = rows.slice(cursor, cursor + capacityForThisSheet);
      freshCount = sheetRows.length;
    } else {
      // repeat the overlap tail from the previous sheet's *source* position,
      // i.e. re-take the last BYTE_ROWS rows already consumed
      const overlapSource = rows.slice(Math.max(0, cursor - overlapRows), cursor);
      freshCount = Math.max(0, capacityForThisSheet - overlapSource.length);
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
      leadOverlapRows: sheets.length === 0 ? 0 : overlapRows
    });
  }

  return sheets;
}

// ================= Rendering orchestration =================

const SHEETS_PER_PAGE = 10;

function rebuild() {
  const bytes = buildByteSequence();
  state.bytes = bytes;

  const paperKey = document.getElementById("paper-size").value;
  const paper = PAPER[paperKey];
  const marginMm = parseFloat(document.getElementById("sheet-margin").value) || 12;
  const joinMode = document.querySelector('input[name="joinmode"]:checked').value;
  LANE_GLUE_MM = Math.max(0, parseFloat(document.getElementById("lane-glue").value) || 0);
  SHOW_FOLD_LABELS = document.getElementById("fold-labels").checked;

  const rows = buildRowList(bytes);
  const sheetsData = rows.length > 0 ? splitIntoSheets(rows, paper, marginMm, joinMode) : [];

  // Stash everything rebuild-page needs so pagination clicks can re-render
  // the preview without recomputing the tape from scratch.
  state.sheetsData = sheetsData;
  state.paper = paper;
  state.marginMm = marginMm;
  state.joinMode = joinMode;
  if (!state.currentPage) state.currentPage = 0;
  const totalPages = Math.max(1, Math.ceil(sheetsData.length / SHEETS_PER_PAGE));
  if (state.currentPage >= totalPages) state.currentPage = totalPages - 1;

  renderPreviewPage();

  // ---- render print copy (physical mm sizing, one per page, ALL sheets
  // regardless of screen pagination — pagination is a screen-preview
  // convenience only, printing always includes every sheet) ----
  const printRoot = document.getElementById("print-root");
  printRoot.innerHTML = "";
  let printFoldNumber = 1; // continuous across sheets, see renderSheetSVG
  sheetsData.forEach((sheetData, idx) => {
    const page = document.createElement("div");
    page.className = "print-page";
    const svg = renderSheetSVG({
      sheetWmm: paper.w, sheetHmm: paper.h, marginMm,
      rows: sheetData.rows,
      sheetIndex: idx, totalSheets: sheetsData.length,
      isFirstSheet: idx === 0, isLastSheet: idx === sheetsData.length - 1,
      joinMode, leadOverlapRows: sheetData.leadOverlapRows,
      foldNumberStart: printFoldNumber
    });
    printFoldNumber = svg._nextFoldNumber;
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

// Renders only the current page's slice of sheets into the screen preview,
// plus the pagination control strip. Sheets stack vertically (no
// horizontal scrolling) and each SVG scales down to fit the container via
// CSS (max-width:100%), so a sheet's full physical width is always visible
// without needing to scroll sideways — this also means every lane's
// trailing content (glue zones, trailers) is always on-screen rather than
// potentially clipped off to the right of a narrow viewport.
function renderPreviewPage() {
  const { sheetsData, paper, marginMm, joinMode } = state;
  const container = document.getElementById("sheets");
  container.innerHTML = "";

  const totalPages = Math.max(1, Math.ceil(sheetsData.length / SHEETS_PER_PAGE));
  const page = state.currentPage || 0;
  const startIdx = page * SHEETS_PER_PAGE;
  const endIdx = Math.min(sheetsData.length, startIdx + SHEETS_PER_PAGE);

  const usableW = paper.w - marginMm * 2;
  const usableH = paper.h - marginMm * 2;

  // Fold numbers must stay continuous across the WHOLE tape even though
  // only one page of sheets renders at a time — count folds from every
  // sheet BEFORE this page (without re-rendering them) to find the right
  // starting number for the first sheet actually shown here.
  let foldNumber = 1;
  for (let idx = 0; idx < startIdx; idx++) {
    foldNumber += countFoldsInSheet(
      sheetsData[idx].rows.length, usableW, usableH,
      idx === 0, idx === sheetsData.length - 1
    );
  }

  for (let idx = startIdx; idx < endIdx; idx++) {
    const sheetData = sheetsData[idx];
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
      joinMode, leadOverlapRows: sheetData.leadOverlapRows,
      foldNumberStart: foldNumber
    });
    foldNumber = svg._nextFoldNumber;
    wrap.appendChild(svg);
    container.appendChild(wrap);
  }

  renderPaginationControls(totalPages);
}

function renderPaginationControls(totalPages) {
  const pager = document.getElementById("pagination");
  pager.innerHTML = "";

  if (totalPages <= 1) return; // nothing to paginate

  const page = state.currentPage || 0;

  const prevBtn = document.createElement("button");
  prevBtn.textContent = "← Prev";
  prevBtn.disabled = page === 0;
  prevBtn.addEventListener("click", () => {
    state.currentPage = Math.max(0, page - 1);
    renderPreviewPage();
  });
  pager.appendChild(prevBtn);

  // Numbered page buttons — fine at the sizes this tool realistically
  // produces (sheets counts stay in the tens to low hundreds, so page
  // counts stay small enough to show every page number directly).
  for (let p = 0; p < totalPages; p++) {
    const btn = document.createElement("button");
    btn.textContent = String(p + 1);
    if (p === page) btn.classList.add("active");
    btn.addEventListener("click", () => {
      state.currentPage = p;
      renderPreviewPage();
    });
    pager.appendChild(btn);
  }

  const nextBtn = document.createElement("button");
  nextBtn.textContent = "Next →";
  nextBtn.disabled = page >= totalPages - 1;
  nextBtn.addEventListener("click", () => {
    state.currentPage = Math.min(totalPages - 1, page + 1);
    renderPreviewPage();
  });
  pager.appendChild(nextBtn);

  const info = document.createElement("span");
  info.className = "page-info";
  info.textContent = `(${SHEETS_PER_PAGE} sheets per page)`;
  pager.appendChild(info);
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
  ["paper-size", "sheet-margin", "lane-glue", "fold-labels", "fixed-length", "fixed-length-unit",
   "pattern-byte", "pattern-count"].forEach(id => {
    document.getElementById(id).addEventListener("change", rebuild);
  });
  document.querySelectorAll('input[name="joinmode"]').forEach(r => r.addEventListener("change", rebuild));
}

document.addEventListener("DOMContentLoaded", () => {
  setupUI();
  rebuild();
});
