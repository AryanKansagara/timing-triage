// A small SDC reader: enough Tcl to understand the constraint commands Timing Analyzer cares about.
import type { Clock, Issue } from './types.ts'

export interface Stmt { cmd: string; words: string[]; line: number; text: string }

/** Splits SDC text into commands, joining backslash continuations and dropping comments. */
export function statements(text: string): Stmt[] {
  const out: Stmt[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const start = i
    let buf = lines[i]
    while (/\\\s*$/.test(buf) && i + 1 < lines.length) buf = buf.replace(/\\\s*$/, ' ') + lines[++i]
    for (const part of splitSemis(buf)) {
      const t = part.trim()
      if (!t || t.startsWith('#')) continue
      const words = tokenize(t)
      if (words.length) out.push({ cmd: words[0], words: words.slice(1), line: start + 1, text: t })
    }
  }
  return out
}

function splitSemis(s: string): string[] {
  const out: string[] = []
  let depth = 0, cur = ''
  for (const ch of s) {
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1)
    if (ch === ';' && depth === 0) { out.push(cur); cur = ''; continue }
    if (ch === '#' && depth === 0 && !cur.trim()) break
    cur += ch
  }
  if (cur.trim() && !cur.trim().startsWith('#')) out.push(cur)
  return out
}

/** Tcl-ish words: {braced} and [bracketed] groups stay whole, quotes are removed. */
export function tokenize(s: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++
    if (i >= s.length) break
    const open = s[i]
    if (open === '{' || open === '[') {
      const close = open === '{' ? '}' : ']'
      let depth = 0, j = i
      for (; j < s.length; j++) {
        if (s[j] === open) depth++
        else if (s[j] === close && --depth === 0) break
      }
      out.push(s.slice(i, j + 1))
      i = j + 1
    } else if (open === '"') {
      const j = s.indexOf('"', i + 1)
      out.push(s.slice(i + 1, j < 0 ? s.length : j))
      i = j < 0 ? s.length : j + 1
    } else {
      let j = i
      let depth = 0
      while (j < s.length && (depth > 0 || !/\s/.test(s[j]))) {
        if (s[j] === '[') depth++
        else if (s[j] === ']') depth--
        j++
      }
      out.push(s.slice(i, j))
      i = j
    }
  }
  return out
}

const FLAGS = new Set(['-asynchronous', '-exclusive', '-logically_exclusive', '-physically_exclusive', '-setup', '-hold', '-start', '-end', '-add', '-max', '-min', '-rise', '-fall', '-invert', '-combinational', '-clock_fall', '-add_delay', '-source_latency_included', '-network_latency_included', '-reference_pin', '-datapath_only'])

export interface Opts { flags: Set<string>; opts: Map<string, string[]>; pos: string[] }

export function options(words: string[]): Opts {
  const o: Opts = { flags: new Set(), opts: new Map(), pos: [] }
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (/^-[a-z_]+$/.test(w)) {
      if (FLAGS.has(w)) { o.flags.add(w); continue }
      const v = words[i + 1]
      if (v !== undefined) { o.opts.set(w, [...(o.opts.get(w) ?? []), v]); i++ }
      else o.flags.add(w)
    } else o.pos.push(w)
  }
  return o
}

export interface Collection { kind: string; patterns: string[] }

/** `[get_clocks {a b}]` -> { kind: 'get_clocks', patterns: ['a', 'b'] }; `{a b}` -> kind ''. */
export function collection(word: string | undefined): Collection {
  if (!word) return { kind: '', patterns: [] }
  let w = word.trim()
  let kind = ''
  if (w.startsWith('[') && w.endsWith(']')) {
    const inner = tokenize(w.slice(1, -1))
    kind = inner[0] ?? ''
    const args = options(inner.slice(1)).pos
    return { kind, patterns: args.flatMap(a => listOf(a)) }
  }
  return { kind, patterns: listOf(w) }
}
const listOf = (w: string) => (w.startsWith('{') && w.endsWith('}') ? w.slice(1, -1) : w).split(/\s+/).filter(Boolean)

const globCache = new Map<string, RegExp>()
export function glob(pattern: string, name: string) {
  let re = globCache.get(pattern)
  if (!re) {
    re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
    globCache.set(pattern, re)
  }
  return re.test(name)
}
export const matches = (c: Collection, name: string) => c.patterns.some(p => glob(p, name))

// ---------- Model ----------

export interface ClockGroups { line: number; groups: Collection[]; kind: string }
export interface Cut { line: number; from?: Collection; to?: Collection; through?: boolean; text: string }
export interface Multicycle { line: number; setup: boolean; hold: boolean; n: number; from?: Collection; to?: Collection; text: string }
export interface IoDelay { line: number; dir: 'input' | 'output'; clock?: string; ports: Collection; value?: number; max: boolean; min: boolean }

export interface SdcModel {
  clocks: (Clock & { line: number; divide?: number; multiply?: number })[]
  derivePll: number | null
  deriveUncertainty: number | null
  groups: ClockGroups[]
  falsePaths: Cut[]
  multicycles: Multicycle[]
  io: IoDelay[]
  stmts: Stmt[]
}

export function parseSdc(text: string): SdcModel {
  const m: SdcModel = { clocks: [], derivePll: null, deriveUncertainty: null, groups: [], falsePaths: [], multicycles: [], io: [], stmts: statements(text) }
  for (const s of m.stmts) {
    const o = options(s.words)
    const first = (k: string) => o.opts.get(k)?.[0]
    switch (s.cmd) {
      case 'create_clock': {
        const targets = collection(o.pos[0])
        const name = stripBraces(first('-name')) ?? targets.patterns[0] ?? ''
        const period = Number(first('-period'))
        m.clocks.push({ name, period, kind: o.pos.length ? 'base' : 'virtual', source: targets.patterns[0], line: s.line })
        break
      }
      case 'create_generated_clock': {
        const name = stripBraces(first('-name')) ?? collection(o.pos[0]).patterns[0] ?? ''
        const master = stripBraces(first('-master_clock')) ?? undefined
        const src = collection(first('-source')).patterns[0]
        m.clocks.push({ name, period: NaN, kind: 'generated', master, source: src, line: s.line, divide: Number(first('-divide_by')) || 1, multiply: Number(first('-multiply_by')) || 1 })
        break
      }
      case 'derive_pll_clocks': m.derivePll = s.line; break
      case 'derive_clock_uncertainty': m.deriveUncertainty = s.line; break
      case 'set_clock_groups': {
        const kind = ['-asynchronous', '-exclusive', '-logically_exclusive', '-physically_exclusive'].find(f => o.flags.has(f)) ?? ''
        m.groups.push({ line: s.line, kind, groups: (o.opts.get('-group') ?? []).map(g => { const c = collection(g); return { kind: c.kind || 'get_clocks', patterns: c.patterns } }) })
        break
      }
      case 'set_false_path':
        m.falsePaths.push({ line: s.line, from: first('-from') ? collection(first('-from')) : undefined, to: first('-to') ? collection(first('-to')) : undefined, through: o.opts.has('-through'), text: s.text })
        break
      case 'set_multicycle_path':
        m.multicycles.push({ line: s.line, setup: o.flags.has('-setup') || !o.flags.has('-hold'), hold: o.flags.has('-hold'), n: Number(o.pos[0]), from: first('-from') ? collection(first('-from')) : undefined, to: first('-to') ? collection(first('-to')) : undefined, text: s.text })
        break
      case 'set_input_delay':
      case 'set_output_delay':
        m.io.push({ line: s.line, dir: s.cmd === 'set_input_delay' ? 'input' : 'output', clock: stripBraces(collection(first('-clock')).patterns[0]), ports: collection(o.pos[1] ?? o.pos[0]), value: Number(o.pos[0]), max: o.flags.has('-max'), min: o.flags.has('-min') })
        break
    }
  }
  // Resolve generated clock periods from their master.
  for (const c of m.clocks) {
    if (c.kind !== 'generated') continue
    const master = m.clocks.find(x => x.name === c.master || (c.source && (x.source === c.source || x.name === c.source)))
    if (master && Number.isFinite(master.period)) { c.master = master.name; c.period = master.period * (c.divide ?? 1) / (c.multiply ?? 1) }
  }
  return m
}
const stripBraces = (s: string | undefined) => s?.replace(/^\{|\}$/g, '').trim()

// ---------- Constraint queries ----------

const clockSide = (c: Collection | undefined) => !!c && c.kind === 'get_clocks'

/** True when the SDC cuts timing between two clocks (clock groups or a clock-to-clock false path). */
export function clocksCut(m: SdcModel | null, a: string, b: string): number | null {
  if (!m || a === b) return null
  for (const g of m.groups) {
    const ia = g.groups.findIndex(x => matches(x, a)), ib = g.groups.findIndex(x => matches(x, b))
    if (g.groups.length === 1) { if ((ia === 0) !== (ib === 0)) return g.line }
    else if (ia >= 0 && ib >= 0 && ia !== ib) return g.line
  }
  for (const f of m.falsePaths) {
    if (clockSide(f.from) && clockSide(f.to) && matches(f.from!, a) && matches(f.to!, b)) return f.line
    if (clockSide(f.from) && !f.to && matches(f.from!, a)) return f.line
    if (clockSide(f.to) && !f.from && matches(f.to!, b)) return f.line
  }
  return null
}

/** True when a node-level false path covers this path. */
export function pathCut(m: SdcModel | null, from: string, to: string): number | null {
  if (!m) return null
  for (const f of m.falsePaths) {
    if (clockSide(f.from) || clockSide(f.to) || f.through) continue
    const okF = !f.from || matches(f.from, from)
    const okT = !f.to || matches(f.to, to)
    if (okF && okT && (f.from || f.to)) return f.line
  }
  return null
}

export function ioConstrained(m: SdcModel | null, port: string): boolean {
  return !!m?.io.some(d => matches(d.ports, port))
}

// ---------- Linter ----------

export interface LintFinding extends Issue { rule: string; fix?: string }

export function lintSdc(m: SdcModel, reportClocks: Clock[] = [], tool: string = 'quartus'): LintFinding[] {
  const out: LintFinding[] = []
  const add = (rule: string, line: number, level: LintFinding['level'], message: string, fix?: string) => out.push({ rule, line, level, message, fix })

  const seen = new Map<string, number>()
  for (const c of m.clocks) {
    if (c.kind === 'generated') continue
    if (!Number.isFinite(c.period) || c.period <= 0) { add('period', c.line, 'error', `create_clock ${c.name || '(unnamed)'} has no valid -period. Periods are in ns.`); continue }
    if (c.period < 1) add('period', c.line, 'warn', `${c.name}: period ${c.period} ns is faster than 1 GHz. Did you mean ${c.period * 1000} ns?`)
    if (c.period > 1000) add('period', c.line, 'warn', `${c.name}: period ${c.period} ns is slower than 1 MHz. Check the units; -period is in ns.`)
    const n = Number(c.name.match(/(\d+(?:[._p]\d+)?)\s*(?:m(?:hz)?)?$/i)?.[1]?.replace(/[_p]/, '.'))
    if (n >= 2 && Math.abs(c.period - n) < 1e-6 && Math.abs(1000 / n - c.period) > 0.5) add('period', c.line, 'warn', `${c.name}: -period ${c.period} looks like the frequency in MHz. A ${n} MHz clock has a period of ${(1000 / n).toFixed(3)} ns.`, `create_clock -name {${c.name}} -period ${(1000 / n).toFixed(3)} ${c.source ? `[get_ports {${c.source}}]` : ''}`.trim())
    if (seen.has(c.name)) add('duplicate', c.line, 'warn', `${c.name} is created twice (first on line ${seen.get(c.name)}). The later definition replaces the first unless -add is used.`)
    seen.set(c.name, c.line)
  }

  const pllInReport = reportClocks.some(c => c.kind === 'generated' || /pll|clk\[\d+\]|outclk/i.test(c.name))
  if (tool !== 'vivado' && m.derivePll === null && !m.clocks.some(c => c.kind === 'generated'))
    add('derive_pll_clocks', 1, pllInReport ? 'error' : 'warn', pllInReport ? 'The design uses PLL output clocks but the SDC never calls derive_pll_clocks or create_generated_clock, so PLL outputs are unconstrained.' : 'No derive_pll_clocks or create_generated_clock. If the design has a PLL, its outputs are unconstrained.', 'derive_pll_clocks -create_base_clocks')
  if (tool !== 'vivado' && m.deriveUncertainty === null)
    add('derive_clock_uncertainty', 1, 'warn', 'Missing derive_clock_uncertainty. Without it, PLL jitter and clock uncertainty are not included and slack is optimistic.', 'derive_clock_uncertainty')

  const all = [...new Set([...m.clocks.map(c => c.name), ...reportClocks.map(c => c.name)])].filter(Boolean)
  if (all.length > 1) {
    const roots = new Map<string, string>()
    const rootOf = (n: string): string => {
      const c = m.clocks.find(x => x.name === n) ?? reportClocks.find(x => x.name === n)
      return c?.master && c.master !== n ? rootOf(c.master) : n
    }
    for (const n of all) roots.set(n, rootOf(n))
    const families = new Set(roots.values())
    if (families.size > 1) {
      const grouped = (n: string) => m.groups.some(g => g.groups.some(x => matches(x, n))) || m.falsePaths.some(f => (clockSide(f.from) && matches(f.from!, n)) || (clockSide(f.to) && matches(f.to!, n)))
      const loose = all.filter(n => !grouped(n) && reportClocks.find(c => c.name === n)?.kind !== 'virtual' && m.clocks.find(c => c.name === n)?.kind !== 'virtual')
      if (loose.length) add('clock_groups', 1, 'warn', `${loose.length} clock${loose.length > 1 ? 's are' : ' is'} not in any set_clock_groups: ${loose.slice(0, 4).join(', ')}${loose.length > 4 ? '…' : ''}. Timing Analyzer treats every pair of clocks as related, so crossings between unrelated clocks get impossible requirements.`)
    }
  }

  for (const f of m.falsePaths) {
    const pats = [...(f.from?.patterns ?? []), ...(f.to?.patterns ?? [])]
    if (!f.from && !f.to && !f.through) add('broad_false_path', f.line, 'error', 'set_false_path with no -from, -to or -through cuts every path in the design.')
    else if (pats.some(p => p === '*' || p === '*|*')) add('broad_false_path', f.line, 'warn', `Overly broad false path: "${f.text.slice(0, 90)}". A bare * matches every register or clock, which hides real failures.`)
    else if (clockSide(f.from) && clockSide(f.to)) add('false_path_clocks', f.line, 'info', 'Clock-to-clock false path. set_clock_groups -asynchronous states the intent more clearly and cuts both directions.')
  }

  for (const mc of m.multicycles) {
    if (!mc.setup || mc.hold) continue
    const twin = m.multicycles.find(x => x.hold && x.from?.patterns.join() === mc.from?.patterns.join() && x.to?.patterns.join() === mc.to?.patterns.join())
    if (!twin && mc.n > 1) add('multicycle_hold', mc.line, 'warn', `set_multicycle_path -setup ${mc.n} without a matching -hold ${mc.n - 1}. The hold check moves with the setup edge and will likely fail.`, mc.text.replace(/-setup\s+/, '-hold ').replace(new RegExp(`\\s${mc.n}(\\s|$)`), ` ${mc.n - 1}$1`))
  }

  for (const d of m.io) {
    if (!d.clock) add('io_clock', d.line, 'error', `set_${d.dir}_delay without -clock. The delay is ignored.`)
    if (!d.max && !d.min) add('io_minmax', d.line, 'info', `set_${d.dir}_delay without -max/-min applies the same value to setup and hold. Usually you want separate -max and -min values from the device datasheet.`)
  }
  return out.sort((a, b) => a.line - b.line)
}
