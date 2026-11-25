import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze } from './analyze.ts'
import { applyToSdc, buildFixes, fixesSdc, LEFT_OUT, pathsCsv } from './fixes.ts'
import { lintSdc, parseSdc } from './sdc.ts'
import type { Format, ParsedReport, TimingPath } from './types.ts'

const p = (o: Partial<TimingPath>): TimingPath => ({ id: Math.random() + '', analysis: 'setup', slack: -1, from: 'u|a', to: 'u|b', launch: 'clk', latch: 'clk', relationship: 10, dataDelay: 5, line: 1, ...o })
const run = (paths: TimingPath[], o: Partial<ParsedReport> = {}) => analyze({ report: { format: 'quartus', paths, clocks: [{ name: 'clk', period: 10 }], summary: [], unconstrained: [], transfers: [], issues: [], found: [], ...o } })
const BAD = ['u|b}] [exec touch x] {', 'u|b{', '}', 'u|b\\', 'u|b\rexec touch x', 'u|b\u2028exec x']

/** Every way a name gets into a fix: registers, fanout, clocks, groups, ports, skew, undefined clocks. */
const everything = (n: string, format: Format) => {
  const r = run([
    p({ from: n, to: n, levels: 20 }), p({ from: n, levels: 1, fanout: 900 }), p({ launch: n, latch: n, skew: -3, dataDelay: 1 }), p({ launch: n, latch: 'clk' }),
    p({ from: n, launch: '', latch: 'clk' }), p({ to: n, latch: '' }), p({ launch: 'def', latch: 'def' }),
  ], { format, clocks: [{ name: 'clk', period: 10 }, { name: n, period: 8 }], defaultClocks: ['def', n], unconstrained: [{ kind: 'input', name: n }, { kind: 'output', name: n }, { kind: 'clock', name: n }, { kind: 'clock', name: 'u/' + n }] })
  const r2 = run([p({ launch: n, latch: 'clk' }), p({ launch: n, latch: n, skew: -3, dataDelay: 1 }), p({ from: n, to: n, levels: 20 })], { format, clocks: [{ name: n, period: 8 }, { name: 'clk', period: 10 }], unconstrained: [{ kind: 'clock', name: 'u|div' }, { kind: 'input', name: 'q' }] })
  return [r, r2].flatMap(x => buildFixes(x, x.clockDefs))
}
/** Tcl words split like Tcl does: a line is safe when each brace closes on that line. */
const balanced = (l: string) => { let d = 0; for (const c of l) { if (c === '{') d++; if (c === '}' && --d < 0) return false } return d === 0 }

test('a node or clock name cannot leave its braces in any fix', () => {
  for (const format of ['quartus', 'vivado'] as const) for (const bad of BAD) {
    const fixes = everything(bad, format)
    assert.ok(fixes.length > 4)
    const text = [fixesSdc(fixes, 'x\\\nexec touch x'), ...fixes.map(f => f.qsf ?? ''), ...fixes.map(f => applyToSdc('', f, 'd'))].join('\n')
    for (const l of text.split(/[\r\n\u2028]/)) {
      assert.ok(!/\\$/.test(l) || /^(set_clock_groups|  -group)/.test(l), l)
      if (l.startsWith('#') && !/^# set_/.test(l)) continue
      assert.ok(balanced(l) && !/exec/.test(l), JSON.stringify(l))
    }
    assert.ok(text.includes(LEFT_OUT))
  }
})

test('ordinary names, also VHDL generate names with a backslash, keep their lines', () => {
  for (const n of ['u|b[3]', '\\gen:0:u|b', 'e:u|b~reg0', 'u/b_reg[0]', 'a b', '$x', 'u|b;c']) {
    const fixes = everything(n, 'quartus')
    assert.ok(!JSON.stringify(fixes).includes(LEFT_OUT), n)
  }
  const r = run([p({ from: 'u|b', fanout: 900 })])
  assert.match(buildFixes(r, r.clockDefs).map(f => f.qsf).join('\n'), /MAX_FANOUT 56 -to \{u\|b\}/)
})

test('lint fixes leave such names out too', () => {
  const l = (name: string) => lintSdc(parseSdc(`create_clock -name "${name}" -period 100 [get_ports a]`)).find(x => x.rule === 'period')
  assert.match(l('clk100')!.fix!, /-name \{clk100\}/)
  assert.equal(l('a}] [exec x] {100')?.fix, undefined)
})

test('CSV text that a spreadsheet would run is neutralised, numbers stay numbers', () => {
  const csv = (o: Partial<TimingPath>) => pathsCsv(run([p(o)])).split('\n')[1]
  for (const [n, cell] of [['=HYPERLINK("http://x","y")', `"'=HYPERLINK(""http://x"",""y"")"`], ['+1', "'+1"], ['-1', "'-1"], ['@SUM(A1)', "'@SUM(A1)"], [' =1', "' =1"], ['\t=1', "'\t=1"], ['＝1', "'＝1"]]) {
    assert.ok(csv({ from: n }).startsWith(`setup,-1,${cell},`), csv({ from: n }))
    assert.ok(csv({ latch: n }).includes(`,${cell},`))
  }
  assert.ok(csv({ from: 'a\rb' }).includes('"a\rb"'))
  assert.equal(csv({ slack: -1.25, skew: -0.5 }), 'setup,-1.25,u|a,u|b,clk,clk,10,-0.5,5,,,Clock skew,,1'.replace('Clock skew', csv({ slack: -1.25, skew: -0.5 }).split(',')[11]))
  assert.ok(csv({ from: 'u|a=b', to: 'a-b' }).includes(',u|a=b,a-b,'))
})
