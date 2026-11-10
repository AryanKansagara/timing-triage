import { Code, Link } from './ui.tsx'

const QUARTUS_TCL = `# export_timing.tcl  ·  run from the project directory:
#   quartus_sta -t export_timing.tcl <project> [<revision>]
set project  [lindex $quartus(args) 0]
set revision [expr {[llength $quartus(args)] > 1 ? [lindex $quartus(args) 1] : $project}]

project_open $project -revision $revision
create_timing_netlist -model slow
read_sdc
update_timing_netlist

report_clocks -file triage_clocks.rpt
report_clock_transfers -setup -file triage_transfers.rpt
report_ucp -file triage_unconstrained.rpt
report_timing -setup -npaths 1000 -detail full_path -file triage_setup.rpt
report_timing -hold  -npaths 200  -detail full_path -file triage_hold.rpt

delete_timing_netlist
project_close`

const VIVADO_TCL = `# In the Vivado Tcl console after implementation (or in a batch script)
open_run impl_1
report_timing_summary -max_paths 50 -report_unconstrained -file timing_summary.rpt
report_timing -delay_type min_max -max_paths 200 -nworst 1 -path_type full -file timing_paths.rpt`

const QSF = `# .qsf: make every full compile write worst-case paths into output_files/<rev>.sta.rpt
set_global_assignment -name TIMING_ANALYZER_REPORT_WORST_CASE_TIMING_PATHS ON
set_global_assignment -name TIMING_ANALYZER_REPORT_NUM_WORST_CASE_TIMING_PATHS 100`

const MIN_SDC = `# Minimal Quartus SDC for a board clock, a PLL and an unrelated UART clock
create_clock -name clk_50 -period 20.000 [get_ports {CLOCK_50}]
create_clock -name uart_clk -period 100.000 [get_ports {UART_CLK}]
derive_pll_clocks
derive_clock_uncertainty
set_clock_groups -asynchronous \\
  -group [get_clocks {clk_50 *pll*}] \\
  -group [get_clocks {uart_clk}]`

export default function Docs() {
  return (
    <section className="page narrow docs">
      <div className="eyebrow">Docs</div>
      <h1>Getting reports out of Quartus and Vivado</h1>
      <p className="lede">Timing Triage reads the plain-text panels Timing Analyzer writes. Nothing is uploaded: files are parsed in your browser.</p>
      <nav className="toc" aria-label="On this page">
        <a href="#quartus">Quartus Tcl export</a><a href="#gui">From the GUI</a><a href="#sta">.sta.rpt</a><a href="#sdc">Your .sdc</a><a href="#vivado">Vivado</a><a href="#rules">How causes are decided</a><a href="#data">Your data</a>
      </nav>

      <h2 id="quartus">1. Quartus Prime: one Tcl script (recommended)</h2>
      <p>Save this as <code>export_timing.tcl</code> next to your <code>.qpf</code> and run it after a full compile. It writes five files; drop all of them into a design&rsquo;s <b>Data</b> tab together with your <code>.sdc</code>.</p>
      <Code label="Tcl" code={QUARTUS_TCL} />
      <ul>
        <li><code>report_timing -detail full_path</code> includes the per-path Statistics (logic levels, clock skew) and the Data Arrival Path table (fanout of every node). Without <code>-detail full_path</code> you still get slack and clocks, but not logic-depth or fanout causes.</li>
        <li>Raise <code>-npaths</code> if you have more failing endpoints; files up to 40 MB are fine.</li>
        <li><code>report_ucp</code> lists unconstrained input and output ports; those become I/O fixes.</li>
        <li>Use <code>-model fast</code> as well if hold fails only at the fast corner.</li>
      </ul>

      <h2 id="gui">2. From the Timing Analyzer GUI</h2>
      <ol>
        <li>Tools &gt; Timing Analyzer, then double-click <b>Update Timing Netlist</b> in the Tasks pane.</li>
        <li>Reports &gt; Custom Reports &gt; <b>Report Timing…</b>: setup, report number of paths 1000, detail level <b>Full path</b>, and tick <b>Report panel name</b> plus <b>File name</b> with a <code>.rpt</code> path. The Tcl command it runs is shown at the bottom of the dialog.</li>
        <li>Optional: run <b>Report Clocks</b> and <b>Report Unconstrained Paths</b> the same way, or right-click any report panel and choose <b>Export…</b>.</li>
        <li>You can also select the rows of any report table, copy, and paste them on the Data tab.</li>
      </ol>

      <h2 id="sta">3. The compile report (.sta.rpt)</h2>
      <p><code>output_files/&lt;revision&gt;.sta.rpt</code> already contains the clock table, per-clock setup/hold summaries, clock transfers and unconstrained ports. To make it include worst-case paths too, add this to your <code>.qsf</code> (older Quartus versions spell it <code>TIMEQUEST_…</code>):</p>
      <Code label="QSF" code={QSF} />

      <h2 id="sdc">4. Your constraints</h2>
      <p>Add the <code>.sdc</code> your project uses (Assignments &gt; Settings &gt; Timing Analyzer lists them). The linter checks:</p>
      <ul>
        <li><code>create_clock</code> period sanity: missing, under 1 ns, over 1000 ns, or a period that equals the MHz in the clock name (<code>-period 50</code> on <code>clk_50</code>).</li>
        <li>Missing <code>derive_pll_clocks</code> (error when the report shows PLL clocks) and <code>derive_clock_uncertainty</code>.</li>
        <li>Clocks from different sources that are not in any <code>set_clock_groups</code>.</li>
        <li><code>set_false_path</code> with no endpoints or a bare <code>*</code>.</li>
        <li><code>set_multicycle_path -setup N</code> without the matching <code>-hold N-1</code>.</li>
        <li><code>set_input_delay</code>/<code>set_output_delay</code> without <code>-clock</code> or without separate <code>-max</code>/<code>-min</code>.</li>
      </ul>
      <p>No .sdc yet? The minimal shape for a typical board looks like this:</p>
      <Code label="SDC" code={MIN_SDC} />

      <h2 id="vivado">5. Vivado (secondary)</h2>
      <p>The same analysis runs on Vivado text reports. XDC uses SDC syntax, so constraint lint and <code>set_clock_groups</code> fixes work; the Quartus-only <code>derive_*</code> checks are skipped.</p>
      <Code label="Tcl" code={VIVADO_TCL} />

      <h2 id="rules">How root causes are decided</h2>
      <p>Assumptions as of November 2026. Each failing, un-cut path gets the first cause that matches:</p>
      <ol>
        <li><b>I/O</b>: an endpoint is a top-level port (listed as unconstrained, named in a <code>set_*_delay</code>, or a name with no hierarchy), or the path has no launch/latch clock.</li>
        <li><b>Unconstrained CDC</b>: launch and latch clocks trace back to different sources. Generated clocks follow their master; PLL outputs from one PLL instance are one family. Crossings covered by <code>set_clock_groups</code> or a clock-to-clock <code>set_false_path</code> are cut and shown as ghosts.</li>
        <li><b>Logic depth</b>: more levels than the budget (default 6; change it in <Link href="/settings">Settings</Link>).</li>
        <li><b>High fanout</b>: a data-path node with fanout at or above the threshold (default 64). Clock network fanout is ignored.</li>
        <li><b>Clock skew</b>: |skew| plus uncertainty is at least half the negative slack.</li>
        <li><b>Routing</b>: everything else.</li>
      </ol>
      <p>TNS is the sum of the worst slack per endpoint, as Timing Analyzer reports it. Fmax is estimated per clock as <code>1000 / (period − worst same-clock slack)</code> MHz; the frequency what-if shifts single-cycle same-clock paths by the period change and leaves cross-clock paths alone.</p>
      <p>Applying an SDC fix appends it to your constraints with a dated comment and re-runs the analysis on the same report. That is exact for clock groups and false paths (they only remove paths). RTL fixes (pipelining, duplication, synchronizers) need a recompile and a new report.</p>

      <h2 id="data">Your data</h2>
      <p>Designs live in your browser (IndexedDB). Signing in is optional; it syncs designs, constraints, applied fixes and run history to your account, plus report files under 1.5 MB per design. Larger reports stay on the device and the design shows a note on other devices. Export everything as JSON or delete your cloud data and account from the account menu.</p>
    </section>
  )
}
