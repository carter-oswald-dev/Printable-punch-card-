# Tape Punch

A static, single-page tool that turns text or raw bytes into a printable
punch-tape layout for the [Arduining.com punched-tape reader](https://arduining.com) —
the 2-pin (clock + data) circuit and sketch used with a 25 mm paper strip.

**Live tool:** open `index.html` directly, or host it via GitHub Pages
(Settings → Pages → deploy from this branch, root folder).

## How the tape actually encodes a bit

Only the **circle** is a real hole. It's the clock/sprocket track that
physically drives the reader, and it's punched on every single row no
matter what the data bit is.

The **second circle** next to it is not a hole — it's a blank cell you fill in
by hand with a pen. Ink it solid for a `1`; leave it blank for a `0`.
This tool prints the data circles already filled in or left blank according to
your data, so — depending on your reader's sensing method — you may be
able to use the sheet straight off the printer with no inking step at all.

## What it does

- Encodes typed text, hex bytes, or a repeating test pattern into the
  clock-hole-and-data-cell pattern the reader expects (MSB-first, one
  clock pulse + one data bit per row, 8 rows per byte).
- Lets you fix the tape to an exact physical length (cm / mm / inches) or a
  byte count, padding with blank rows as needed.
- Tiles long tapes across as many sheets as needed (US Letter or A4), always
  breaking sheets on a byte boundary — never mid-byte.
- Two join styles for combining printed sheets into one continuous tape:
  - **Overlap tab** — repeats the last byte of a sheet, dimmed, at the start
    of the next sheet as a glue guide. Line up the repeat over its printed
    twin and there's no gap and no double-counted byte.
  - **Butt join** — sheets cut exactly on a byte edge with no repeated
    content, for taping/gluing edge-to-edge.
- A blank 30 mm feed buffer at the very start and very end of the whole
  tape — no clock holes, no data cells — so a feed mechanism, roller, or
  your fingers always have plain tape to grip before the first real clock
  pulse and after the last one. Each buffer is labeled CLOCK / DATA with a
  feed-direction arrow, so the strip can only go into the reader one way.
- Print view uses real millimeter sizing via SVG `viewBox`, so **print at
  100% / actual size** (disable "fit to page") to keep the hole pitch
  physically exact.

## Files

- `index.html` — page structure and controls
- `tape.js` — encoding, geometry, sheet-splitting, and SVG rendering

No build step, no dependencies, no external JS — just two files.

## Geometry reference

Base dimensions measured directly from a 300dpi render of the original
Arduining "Punched Tape" PDF; row pitch and stagger are deliberate
departures from that reference, explained below.

- Tape width: 25 mm (measured)
- Clock/data circle diameter: 5.77 mm (measured)
- Clock hole track: 6.30 mm in from its edge of the strip (measured)
- Data cell track: 6.00 mm in from the *opposite* edge of the strip (measured)
- 8 rows per byte, with a marked fold/cut point between bytes

**Row pitch and the clock/data stagger are a deliberate design change,
not the reference measurement.** The reference PDF's rows measure 6.06 mm
apart with clock and data at the same along-tape position. This tool
instead staggers each row's data circle half a hole-width *behind* its
clock circle — clock always reaches the reader first — so the two
contacts are never both sitting over an active feature at the same
instant. Fitting that stagger without adjacent rows' circles overlapping
requires a wider row pitch:

- Row pitch: **9.155 mm** (`clock lead + hole diameter + 0.5mm safety
  gap`, not the reference's 6.06 mm)
- Clock/data stagger: 2.885 mm (half the hole diameter)

This makes each byte of tape roughly 50% longer than the original
reference design, in exchange for guaranteeing physical separation
between the two contacts on every row.

## Feed buffer

A 30 mm stretch of blank tape — no clock holes, no data cells — runs
once at the very start and once at the very end of the whole tape (not
repeated per sheet or per lane), so a feed mechanism always has solid
tape to grip before the first real row and after the last one. Each
buffer is labeled CLOCK / DATA with a feed-direction arrow. This is a
deliberate design addition, not part of the reference PDF.

If a tape is short enough that both the leader and trailer would land in
the same lane, the tool automatically reduces how many data rows go in
that lane so the two buffers and the real data all fit without
overlapping — you may see a short message wrap onto a second lane earlier
than expected as a result.

## Lane glue zone

Every fold within a sheet — the point where one printed row of tape ends
and the next one (below it, on the same sheet) begins — gets a blank
stretch of tape reserved at its end, marked "glue." This is the material
you actually cut to and glue the next lane's start onto once the sheet
is cut apart into strips and reassembled into one continuous tape.

This is separate from the feed buffer above (which only appears once, at
the true start/end of the whole tape) and separate from the sheet-to-sheet
join settings (which control how printed *pages* join together, not lanes
within the same page).

Adjustable in the UI ("Lane glue zone," default 15 mm) — set it to
whatever amount of overlap is comfortable for your glue or tape and how
precisely you can align two cut edges by hand. The very last lane of the
whole tape never gets a glue zone (it gets the feed trailer instead, or
nothing, since there's no next lane to join to).
