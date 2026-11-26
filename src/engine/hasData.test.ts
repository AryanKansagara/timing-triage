import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasData, parseReport } from './parse.ts'
import { samples } from './sample.ts'

const q = (title: string, head: string, ...rows: string[]) => ['+---+', `; ${title} ;`, '+---+', `; ${head} ;`, '+---+', ...rows.map(r => `; ${r} ;`), '+---+', ''].join('\n')

test('a report with nothing read from it holds no data', () => {
  for (const t of ['', 'hello', 'Notes from our Vivado run', '| Tool Version : Vivado v.2024.2\n', q('Setup: clk', 'Slack ; From Node ; To Node'), q('Flow Status', 'a ; b', '1 ; 2')]) assert.equal(hasData(parseReport(t)), false, t)
})

test('supplementary exports still hold data', () => {
  for (const s of samples()) assert.equal(hasData(parseReport(s.report)), true)
  assert.equal(hasData(parseReport(q('Clocks', 'Clock Name ; Type ; Period', 'clk ; Base ; 10.000'))), true)
  assert.equal(hasData(parseReport(q('Unconstrained Input Ports', 'Input Port ; Comment', 'sw ; none'))), true)
  assert.equal(hasData(parseReport(q('Slow Model Setup Summary', 'Clock ; Slack ; End Point TNS', 'clk ; -1.0 ; -2.0'))), true)
  assert.equal(hasData(parseReport(q('Setup Transfers', 'From Clock ; To Clock ; RR Paths', 'a ; b ; 4'))), true)
  assert.equal(hasData(parseReport(samples()[3].report.split('Timing Details')[0])), true)
})

