# Tape Punch

A static, single-page tool that turns text or raw bytes into a printable
punch-tape layout for the [Arduining.com punched-tape reader](https://arduining.com) —
the 2-pin (clock + data) circuit and sketch used with a 25 mm paper strip.

**Live tool:** open `index.html` directly, or host it via GitHub Pages
(Settings → Pages → deploy from this branch, root folder).

## What it does

- Encodes typed text, hex bytes, or a repeating test pattern into the
  clock/data hole pattern the reader expects (MSB-first, one clock pulse +
  one data bit per row, 8 rows per byte).
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
- Print view uses real millimeter sizing via SVG `viewBox`, so **print at
  100% / actual size** (disable "fit to page") to keep the hole pitch
  physically exact.

## Files

- `index.html` — page structure and controls
- `tape.js` — encoding, geometry, sheet-splitting, and SVG rendering

No build step, no dependencies, no external JS — just two files.

## Geometry reference

Measured directly from a 300dpi render of the original Arduining
"Punched Tape" PDF (not estimated):

- Tape width: 25 mm
- Row pitch (clock-to-clock along the strip): **6.06 mm** — this is the
  tape's real "clock rate": each row is one clock pulse in the reader
  sketch, so this pitch is what "how fast you pull the tape" becomes
  electrically
- Hole diameter (clock and data, same size): 5.77 mm
- Clock hole track: 6.30 mm in from its edge of the strip
- Data hole track: 6.00 mm in from the *opposite* edge of the strip
- 8 rows per byte, with a marked fold/cut point between bytes

Clock and data holes sit on opposite edges of the strip at (almost
exactly) the same position along the tape's length — not offset
diagonally within a row.
