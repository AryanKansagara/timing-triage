# Timing Triage

A timing report and SDC constraint analyzer for FPGA designs. Paste or upload Quartus Prime Timing Analyzer reports and your `.sdc`; get failing paths grouped by root cause, unconstrained clock-domain crossings, constraint gaps, and the SDC/QSF lines that fix them.

Live: https://timing-triage.vercel.app

## The pain

Timing Analyzer shows hundreds of failing paths one at a time. The usual forum thread: setup violations between a 25 MHz PLL clock and a 10 MHz clock, paths reported as unconstrained, and the first reply asking "have you created your .sdc file?". The question people actually have is which three things to fix.

## Features

- **Import**: Quartus `report_timing -file` panels, `.sta.rpt`, `report_clocks`, `report_ucp`, clock transfers, plus Vivado `report_timing_summary` text. Format detection, field coverage and a validation report with line numbers. `/docs` has the exact Tcl export script.
- **Engine** (plain TypeScript, tested): path table parser (slack, nodes, clocks, relationship, skew, data delay, logic levels, data-path fanout), WNS/TNS per clock, grouping by clock pair and register bus, root-cause classifier (unconstrained CDC, logic depth, high fanout, skew-dominated, I/O constraint, routing), SDC linter, CDC check with synchronizer guidance, Fmax estimate and frequency what-if.
- **Actions**: fix list with `set_clock_groups`, I/O delay templates, `MAX_FANOUT` / `FAST_INPUT_REGISTER` assignments and pipelining guidance; apply an SDC fix and the analysis re-runs; printable closure report; `fixes.sdc` and paths CSV export.
- **History**: every import is a dated run per design, with a slack trend and a compare view (fixed and newly failing endpoints).
- Local-first workspace in IndexedDB; optional email/password sign-in syncs designs, constraints and runs via Supabase.
- Two synthetic sample designs (VGA + UART on Cyclone V in Quartus format, and an Artix-7 port in Vivado format) with planted CDC, logic-depth, fanout, I/O and skew failures. Clearly labelled synthetic.

## Run locally

```sh
npm install
cp .env.example .env   # optional, enables sync
npm run dev
npm test               # engine tests
npm run build
```

Built by Aryan Kansagara. Independent project, not affiliated with Altera.
