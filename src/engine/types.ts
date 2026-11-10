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

export interface ClockSummary { clock: string; analysis: Analysis; slack: number; tns: number }

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
  transfers: { from: string; to: string; paths: number; falsePath: boolean }[]
  issues: Issue[]
  /** Which tables were recognised, for the validation report */
  found: string[]
}

export type Cause = 'cdc' | 'io' | 'logic' | 'fanout' | 'skew' | 'route'

export interface Settings {
  /** Paths with more logic levels than this are flagged as logic-depth bound */
  maxLevels: number
  /** Fanout at or above this is flagged */
  maxFanout: number
  /** Ignore hold analysis (useful when only setup is exported) */
  includeHold: boolean
}

export const DEFAULT_SETTINGS: Settings = { maxLevels: 6, maxFanout: 64, includeHold: true }
