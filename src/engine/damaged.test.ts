import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseReport } from './parse.ts'
import { samples } from './sample.ts'

const q = (...slacks: string[]) => ['+---+', '; Setup: clk ;', '+---+', '; Slack ; From Node ; To Node ; Launch Clock ; Latch Clock ;', '+---+', ...slacks.map((s, i) => `; ${s} ; u|a${i} ; u|b${i} ; clk ; clk ;`), '+---+', ''].join('\n')
const slack = (s: string) => parseReport(q(s)).paths[0]?.slack

test('slack cells: minus variants, bare decimals and exponents', () => {
  for (const [s, v] of [['-1.234', -1.234], ['−1.234', -1.234], ['–1.234', -1.234], ['-.500', -0.5], ['1e+3', 1000], ['-2e-1', -0.2], ['0.000', 0], ['-1.5 ns', -1.5], ['1,234.5', 1234.5], ['+0.25', 0.25]] as const) assert.equal(slack(s), v, s)
})

test('slack cells that are not a number are skipped with their line', () => {
  for (const s of ['n/a 5', '(1.2)', '- 1.2', '-12.3abc', '--', '1.2.3', 'inf']) {
    const r = parseReport(q(s))
    assert.equal(r.paths.length, 0, s)
    assert.ok(r.issues.some(i => i.line === 6 && /Skipped a path row/.test(i.message)), s)
  }
})

test('node names keep their dashes', () => {
  const r = parseReport(q('-1').replace('u|a0', 'u|x–1'))
  assert.equal(r.paths[0].from, 'u|x–1')
})

test('every way of cutting a Quartus table short is reported', () => {
  const t = q('2.000', '1.000', '-4.000').trimEnd()
  for (let n = t.indexOf('; 1.000') + 1; n < t.length - 5; n++) {
    assert.ok(parseReport(t.slice(0, n)).issues.some(i => /cut off|Skipped/.test(i.message)), JSON.stringify(t.slice(n - 20, n)))
  }
  assert.ok(!parseReport(t).issues.some(i => /cut off/.test(i.message)))
})

test('complete reports and borderless pastes are not called cut off', () => {
  for (const s of samples()) assert.ok(!parseReport(s.report).issues.some(i => /cut off/.test(i.message)), s.id)
})

test('a Vivado block that ends before Path Type is skipped with a warning, a minus sign is normalised', () => {
  const block = (minus: string, tail: string) => `| Tool Version : Vivado v.2024.2\nSlack (VIOLATED) :        ${minus}1.500ns\n  Source:  u_a/x/C\n  Destination:  u_b/y/D\n${tail}`
  const ok = parseReport(block('−', '  Path Type:  Hold (Min at Fast Process Corner)\n'))
  assert.deepEqual(ok.paths.map(p => [p.slack, p.analysis]), [[-1.5, 'hold']])
  const cut = parseReport(block('-', ''))
  assert.equal(cut.paths.length, 0)
  assert.ok(cut.issues.some(i => i.line === 2 && /cut off before Path Type/.test(i.message)))
})
