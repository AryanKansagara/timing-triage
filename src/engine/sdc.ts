// A small SDC reader: enough Tcl to understand the constraint commands Timing Analyzer cares about.
import type { Analysis, Clock, Issue } from './types.ts'

export interface Stmt { cmd: string; words: string[]; line: number; text: string }

/** A line that starts a command of its own, so an open { before it is a Tcl block or a typo, not a list. */
const STARTS_COMMAND = /^\s*(?:(?:create|set|derive|remove|read|group)_\w+|set|if|foreach|while|proc)(?=\s|$)/

/** Splits SDC text into commands, joining backslash continuations and lists in open braces, and dropping comments. */
export function statements(text: string): Stmt[] {
  const out: Stmt[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const start = i
    let buf = lines[i]
    while (/\\\s*$/.test(buf) && i + 1 < lines.length) buf = buf.replace(/\\\s*$/, ' ') + lines[++i]
    // Tcl goes on to the next line inside { } and [ ]. Without a closing one the line is read on its own, as it stands.
    let joined = buf, j = i
    while (openDepth(joined) > 0 && j + 1 < lines.length && j - i < 1000 && !STARTS_COMMAND.test(lines[j + 1])) joined = joined.replace(/\\\s*$/, '') + ' ' + lines[++j].trim()
    if (j > i && openDepth(joined) === 0) { buf = joined; i = j }
    for (const part of splitSemis(buf)) {
      const t = part.trim()
      if (!t || t.startsWith('#')) continue
      const words = tokenize(t)
      if (words.length) out.push({ cmd: words[0], words: words.slice(1), line: start + 1, text: t })
    }
  }
  return out
}

/** How many { and [ are still open at the end of the text, not counting comments and escaped ones. */
function openDepth(s: string) {
  let depth = 0, start = true
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\') { i++; start = false; continue }
    if (ch === '#' && depth === 0 && start) return 0
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1)
    start = (depth === 0 && ch === ';') || (start && /\s/.test(ch))
  }
  return depth
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

const FLAGS = new Set(['-asynchronous', '-exclusive', '-logically_exclusive', '-physically_exclusive', '-setup', '-hold', '-start', '-end', '-add', '-max', '-min', '-rise', '-fall', '-invert', '-combinational', '-clock_fall', '-add_delay', '-source_latency_included', '-network_latency_included', '-reference_pin', '-datapath_only', '-quiet', '-verbose', '-reset_path'])

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

export interface Collection {
  kind: string; patterns: string[]
  /** -hierarchical: patterns name a cell at any level */
  hier?: boolean
  /** -include_generated_clocks: clocks generated from these are included too */
  generated?: boolean
}

const NAMED = /^get_(clocks|ports|cells|pins|registers|keepers|nodes|nets)$/
// Switches of get_* that take no value and do not change which names match, or only narrow it when ignored.
const GET_FLAGS = ['-include_generated_clocks', '-hierarchical', '-quiet', '-verbose', '-nocase', '-nowarn', '-no_duplicates', '-compatibility_mode']
const GET_VALUES = ['-filter', '-of_objects', '-regexp', '-exact', '-hsc', '-leaf', '-match_style', '-physical_constraints']

/**
 * `[get_clocks {a b}]` -> { kind: 'get_clocks', patterns: ['a', 'b'] }; `{a b}` -> kind ''.
 * A collection that is not understood (-filter, -regexp, -of_objects, other commands) has no patterns: it matches nothing.
 */
export function collection(word: string | undefined): Collection {
  if (!word) return { kind: '', patterns: [] }
  const w = word.trim()
  if (!(w.startsWith('[') && w.endsWith(']'))) return { kind: '', patterns: listOf(w) }
  const [kind = '', ...args] = tokenize(w.slice(1, -1))
  if (kind === 'list') {
    const parts = args.map(collection)
    const kinds = new Set(parts.map(p => p.kind))
    // Plain names and collections of another kind cannot share one kind.
    if (kinds.size > 1) return { kind, patterns: [] }
    return { ...parts[0], kind: parts[0]?.kind ?? '', patterns: parts.every(p => !p.hier === !parts[0].hier && !p.generated === !parts[0].generated) ? parts.flatMap(p => p.patterns) : [] }
  }
  const out: Collection = { kind, patterns: [] }
  if (!NAMED.test(kind)) return out
  const patterns: string[] = []
  for (const a of args) {
    if (/^-[a-z_]+$/.test(a)) {
      // Tools accept any unambiguous start of a switch, e.g. -hier.
      const full = [...GET_FLAGS, ...GET_VALUES].filter(f => f === a || f.startsWith(a))
      const flag = full.length === 1 || full[0] === a ? full[0] : undefined
      if (!flag || !GET_FLAGS.includes(flag)) return out
      if (flag === '-hierarchical') out.hier = true
      if (flag === '-include_generated_clocks') out.generated = true
    } else if (a.startsWith('[')) {
      const inner = collection(a)
      if (inner.kind && inner.kind !== kind) return { kind, patterns: [] }
      if (inner.hier) out.hier = true
      if (inner.generated) out.generated = true
      patterns.push(...inner.patterns)
    } else patterns.push(...listOf(a))
  }
  return { ...out, patterns }
}
const listOf = (w: string) => (w.startsWith('{') && w.endsWith('}') ? w.slice(1, -1) : w).split(/\s+/).filter(Boolean)

/** Adds the clocks generated from the named ones where the constraint says -include_generated_clocks. */
export function includeGenerated(m: SdcModel, clocks: Clock[]) {
  for (const c of [...m.groups.flatMap(g => g.groups), ...m.falsePaths.flatMap(f => [f.from, f.to])]) {
    if (!c?.generated || c.kind !== 'get_clocks') continue
    for (let grew = true; grew;) {
      const more = clocks.filter(x => x.master && matches(c, x.master) && !matches(c, x.name))
      c.patterns.push(...more.map(x => x.name))
      grew = more.length > 0
    }
  }
}

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

/**
 * A node of a path against a constraint's nodes. Vivado paths name pins (`u/a_reg/C`) and get_cells names the cell.
 * As in Vivado, a * does not reach over / there, and with -hierarchical the pattern is the cell's own name.
 */
function nodeMatches(c: Collection, node: string) {
  if (!c.hier && matches(c, node)) return true
  if (c.kind !== 'get_cells') return c.hier ? matches(c, node) : false
  const cell = node.replace(/\/[A-Z][A-Z0-9_]*(\[\d+\])?$/, '')
  const name = c.hier ? cell.slice(cell.lastIndexOf('/') + 1) : cell
  return cell !== node && c.patterns.some(p => p.split('/').length === name.split('/').length && p.split('/').every((x, i) => glob(x, name.split('/')[i])))
}

// ---------- Model ----------

export interface ClockGroups { line: number; groups: Collection[]; kind: string }
export interface Cut { line: number; from?: Collection; to?: Collection; through?: boolean; text: string; /** Check the cut is limited to */ only?: 'setup' | 'hold'; /** Limited by -through or a clock edge, which a text report cannot be matched against */ partial?: boolean; /** Edge-limited endpoint options, e.g. -rise_from */ edges: Collection[] }
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
        m.groups.push({ line: s.line, kind, groups: (o.opts.get('-group') ?? []).map(g => { const c = collection(g); return { ...c, kind: c.kind || 'get_clocks' } }) })
        break
      }
      case 'set_false_path':
        {
          const edges = ['-rise_from', '-fall_from', '-rise_to', '-fall_to'].flatMap(k => o.opts.get(k) ?? []).map(collection)
          const through = [...o.opts.keys()].some(k => /^-(rise_|fall_)?through$/.test(k))
          const only = o.flags.has('-setup') === o.flags.has('-hold') ? undefined : o.flags.has('-setup') ? 'setup' : 'hold'
          m.falsePaths.push({ line: s.line, from: first('-from') ? collection(first('-from')) : undefined, to: first('-to') ? collection(first('-to')) : undefined, through, text: s.text, only, edges, partial: through || edges.length > 0 || o.flags.has('-rise') || o.flags.has('-fall') })
        }
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

/** -setup covers setup and recovery, -hold covers hold and removal. */
const applies = (f: Cut, a: Analysis) => !f.partial && (!f.only || (f.only === 'setup') === (a === 'setup' || a === 'recovery'))

/**
 * SDC line that cuts timing between two clocks (clock groups or a clock-to-clock false path), or null.
 * Without an analysis the clocks count as cut only when setup and hold are both cut.
 */
export function clocksCut(m: SdcModel | null, a: string, b: string, analysis?: Analysis): number | null {
  if (!m || a === b) return null
  if (!analysis) return clocksCut(m, a, b, 'hold') === null ? null : clocksCut(m, a, b, 'setup')
  for (const g of m.groups) {
    const ia = g.groups.findIndex(x => matches(x, a)), ib = g.groups.findIndex(x => matches(x, b))
    if (g.groups.length === 1) { if ((ia === 0) !== (ib === 0)) return g.line }
    else if (ia >= 0 && ib >= 0 && ia !== ib) return g.line
  }
  for (const f of m.falsePaths) {
    if (!applies(f, analysis)) continue
    if (clockSide(f.from) && clockSide(f.to) && matches(f.from!, a) && matches(f.to!, b)) return f.line
    if (clockSide(f.from) && !f.to && matches(f.from!, a)) return f.line
    if (clockSide(f.to) && !f.from && matches(f.to!, b)) return f.line
  }
  return null
}

/** SDC line of a node-level false path that covers this path, or null. */
export function pathCut(m: SdcModel | null, from: string, to: string, analysis: Analysis = 'setup'): number | null {
  if (!m) return null
  for (const f of m.falsePaths) {
    if (clockSide(f.from) || clockSide(f.to) || !applies(f, analysis)) continue
    const okF = !f.from || nodeMatches(f.from, from)
    const okT = !f.to || nodeMatches(f.to, to)
    if (okF && okT && (f.from || f.to)) return f.line
  }
  return null
}

export function ioConstrained(m: SdcModel | null, port: string, kind?: 'input' | 'output'): boolean {
  return !!m?.io.some(d => matches(d.ports, port) || (!!kind && d.dir === kind && d.ports.kind === `all_${kind}s`))
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

  // Constraints that name a clock nobody defines are silently ignored by the tool.
  if (reportClocks.length) {
    const known = (pat: string) => all.some(n => glob(pat, n))
    const refs: [number, string][] = [
      ...m.groups.flatMap(g => g.groups.filter(x => x.kind === 'get_clocks').flatMap(x => x.patterns.map(p => [g.line, p] as [number, string]))),
      ...m.falsePaths.flatMap(f => [f.from, f.to].filter(clockSide).flatMap(c => c!.patterns.map(p => [f.line, p] as [number, string]))),
      ...m.io.filter(d => d.clock).map(d => [d.line, d.clock!] as [number, string]),
    ]
    const byLine = new Map<number, string[]>()
    for (const [line, pat] of refs) if (pat && !known(pat)) byLine.set(line, [...new Set([...(byLine.get(line) ?? []), pat])])
    for (const [line, pats] of byLine) add('unknown_clock', line, 'warn', `${pats.join(', ')} ${pats.length > 1 ? 'are' : 'is'} not a clock in the SDC or in the timing report, so this constraint matches nothing and is ignored.`)
  }

  for (const f of m.falsePaths) {
    const pats = [...(f.from?.patterns ?? []), ...(f.to?.patterns ?? []), ...f.edges.flatMap(e => e.patterns)]
    if (!f.from && !f.to && !f.through && !f.edges.length) add('broad_false_path', f.line, 'error', 'set_false_path with no -from, -to or -through cuts every path in the design.')
    else if (pats.some(p => p === '*' || p === '*|*')) add('broad_false_path', f.line, 'warn', `Overly broad false path: "${f.text.slice(0, 90)}". A bare * matches every register or clock, which hides real failures.`)
    else if (clockSide(f.from) && clockSide(f.to)) add('false_path_clocks', f.line, 'info', 'Clock-to-clock false path. set_clock_groups -asynchronous states the intent more clearly and cuts both directions.')
  }

  for (const f of m.falsePaths) if (f.partial) add('partial_false_path', f.line, 'info', 'This false path is limited by -through or by a clock or data edge, which a text report cannot be matched against. It is not applied here, so paths it cuts may still be listed.')

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
