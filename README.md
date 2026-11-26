# Timing Triage

A timing report and SDC constraint analyzer for FPGA designs. Paste or upload Quartus Prime Timing Analyzer reports and your `.sdc`; get failing paths grouped by root cause, unconstrained clock-domain crossings, constraint gaps, and the SDC/QSF lines that fix them.

Live: https://timing-triage.vercel.app

## The pain

Timing Analyzer shows hundreds of failing paths one at a time. The usual forum thread: setup violations between a 25 MHz PLL clock and a 10 MHz clock, paths reported as unconstrained, and the first reply asking "have you created your .sdc file?". The question people actually have is which three things to fix.

## Features

- **Import**: Quartus `.sta.rpt` compile reports (Quartus II 9.1 through Quartus Prime 20.1 checked), `report_timing -file` panels, `report_clocks`, `report_ucp`, clock transfers, plus Vivado `report_timing_summary` text (2016.3 through 2025.1 checked). Format detection, field coverage and a validation report with line numbers. `/docs` has the exact Tcl export script.
- **What it reads from a real report**: tool version and device, clocks and their masters, the tool's own Fmax summary, per-clock and design-wide WNS/TNS and failing endpoint counts, per-corner path tables (worst corner kept), clock transfers, unconstrained ports, check_timing, and the analyzer's messages (SDC not found, default 1 ns clocks, ignored constraints, undefined clocks).
- **Engine** (plain TypeScript, tested): root-cause classifier (no clock constraint, unconstrained CDC, I/O constraint, half-cycle path, logic depth, high fanout, clock skew, routing), grouping by clock pair and register bus, SDC linter, CDC check with synchronizer guidance, Fmax and frequency what-if.
- **Actions**: fix list with `create_clock` for unconstrained clocks, `set_clock_groups`, I/O delay templates, tool-specific assignments (QSF for Quartus, Tcl/XDC properties for Vivado) and pipelining guidance; apply an SDC fix and the analysis re-runs; printable closure report; `fixes.sdc` and paths CSV export.
- **History**: every import is a dated run per design, with a slack trend and a compare view (fixed and newly failing endpoints).
- Local-first workspace in IndexedDB; optional email/password sign-in syncs designs, constraints and runs via Supabase.

## Sample designs

Two are real reports from public repositories, shortened but otherwise unchanged:

- `quartus/MCU.sta.rpt` from [nanamake/avr_cpu](https://github.com/nanamake/avr_cpu), © 2018 NAMAKE Nanamaru, MIT licence. A Quartus II 14.0 compile with no SDC: the clock is timed at the default 1000 MHz and reports −14.7 ns, while the design runs at 63.5 MHz.
- `pyrpl/fpga/out/post_route_timing_summary.rpt` and the timing lines of `red_pitaya.xdc` from [pyrpl-fpga/pyrpl](https://github.com/pyrpl-fpga/pyrpl), © 2014-2025 PyRPL authors, MIT licence. A Vivado 2024.2 post-route report with 11,287 failing endpoints.

Two are synthetic and labelled so (VGA + UART on Cyclone V in Quartus format, and an Artix-7 port in Vivado format) with planted CDC, logic-depth, fanout, I/O and skew failures.

## Known gaps

- Root causes are heuristics on report text. A `.sta.rpt` path table has no logic-level or fanout columns, so depth and fanout causes need a `report_timing -detail full_path` export.
- A report lists only its worst paths. Headline WNS, TNS and endpoint counts come from the tool's summary tables; only the listed paths are classified.
- Re-timing a default clock from the SDC shifts same-clock setup slack by the period change. It is an estimate until the design is recompiled.
- Not read: Quartus Pro HTML report exports, Vivado `check_timing -verbose` port lists, datasheet (tsu/tco) and signal integrity tables.

## Run locally

```sh
npm install
cp .env.example .env   # optional, enables sync
npm run dev
npm test               # engine tests
npm run build
npm run test:e2e      # builds, then runs the Playwright suite (npx playwright install chromium once; E2E_PORT picks the port)
```

Built by Aryan Kansagara.
