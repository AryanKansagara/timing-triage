export type Analysis = 'setup' | 'hold' | 'recovery' | 'removal'

export interface TimingPath {
  id: string
  analysis: Analysis
  slack: number
  from: string
  to: string
  launch: string
  latch: string
  /** Setup or hold relationship between the launch and latch edges, ns */
  relationship?: number
  skew?: number
  dataDelay?: number
  arrival?: number
  required?: number
  levels?: number
  /** Largest fanout of any node on the data path */
  fanout?: number
  uncertainty?: number
  /** Cell and interconnect share of the data path delay, when the report breaks it down */
  logicDelay?: number
  routeDelay?: number
  /** Cell types on the path, e.g. "CARRY4=14 DSP48E1=2 LUT2=1" */
  levelDetail?: string
  /** Operating corner the worst slack was reported at, e.g. "Slow 1200mV 85C Model" */
  corner?: string
  /** 1-based line the path starts on in the source file */
  line: number
}

export interface Clock {
  name: string
  period: number
  kind?: 'base' | 'generated' | 'virtual'
  source?: string
  /** Master clock for generated clocks */
  master?: string
}

export interface ClockSummary {
  clock: string; analysis: Analysis; slack: number; tns: number
  /** Failing and total endpoints, when the tool reports them (Vivado) */
  failing?: number; total?: number
  corner?: string
}

export interface Transfer {
  from: string; to: string; paths: number; falsePath: boolean
  /** Worst slack and failing endpoints for the crossing, when the tool reports them (Vivado Inter Clock Table) */
  wns?: number; failing?: number; holdWns?: number; holdFailing?: number
}

export interface ReportMeta { tool?: string; design?: string; device?: string; state?: string }
export interface Totals { wns: number; tns: number; failing: number; total: number }

export interface Issue { line: number; level: 'error' | 'warn' | 'info'; message: string }

export type Format = 'quartus' | 'vivado' | 'sdc' | 'unknown'

export interface ParsedReport {
  format: Format
  paths: TimingPath[]
  clocks: Clock[]
  /** Per-clock summary rows reported by the tool itself, if present */
  summary: ClockSummary[]
  /** Ports or clocks listed as unconstrained */
  unconstrained: { kind: 'input' | 'output' | 'clock'; name: string }[]
  /** Clock transfers listed in the report, including ones with zero failing paths */
  transfers: Transfer[]
  issues: Issue[]
  /** Which tables were recognised, for the validation report */
  found: string[]
  meta?: ReportMeta
  /** Design-wide totals reported by the tool (Vivado Design Timing Summary) */
  totals?: { setup?: Totals; hold?: Totals }
  /** Fmax the tool reports per clock, worst corner (Quartus Fmax Summary), MHz */
  fmax?: { clock: string; fmax: number; restricted?: number; corner?: string }[]
  /** Clocks Quartus invented with derive_clocks -period 1.0 because no SDC constrained them */
  defaultClocks?: string[]
  /** Counts from the Unconstrained Paths summary or check_timing, when port names are not listed */
  counts?: { inputPorts?: number; outputPorts?: number; clocks?: number }
  /** Worst minimum pulse width slack per clock */
  pulse?: { clock: string; slack: number }[]
}

export type Cause = 'noclock' | 'cdc' | 'io' | 'edge' | 'logic' | 'fanout' | 'skew' | 'route'

export interface Settings {
  /** Paths with more logic levels than this are flagged as logic-depth bound */
  maxLevels: number
  /** Fanout at or above this is flagged */
  maxFanout: number
  /** Ignore hold analysis (useful when only setup is exported) */
  includeHold: boolean
}

export const DEFAULT_SETTINGS: Settings = { maxLevels: 6, maxFanout: 64, includeHold: true }
