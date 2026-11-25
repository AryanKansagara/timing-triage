import { test as base, expect, type Page } from '@playwright/test'

/** Every test runs signed out, with all outside hosts blocked, and fails on an uncaught page error. */
export const test = base.extend<{ outside: string[] }>({
  outside: [async ({ context, page, baseURL }, use) => {
    const blocked: string[] = []
    const errors: string[] = []
    const origin = new URL(baseURL!).origin
    await context.route(url => url.origin !== origin && !['data:', 'blob:'].includes(url.protocol), route => { blocked.push(route.request().url()); return route.abort() })
    page.on('pageerror', e => errors.push(String(e)))
    await use(blocked)
    expect(errors, 'uncaught page errors').toEqual([])
    expect(blocked.filter(u => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)), 'only the web font may be requested from outside').toEqual([])
  }, { auto: true }],
})
export { expect, type Page }

export interface Row { slack: string; from: string; to: string; launch?: string; latch?: string; rel?: string; skew?: string; delay?: string }

const table = (title: string, head: string[], rows: string[][]) => {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)))
  const line = '+' + w.map(n => '-'.repeat(n + 2)).join('+') + '+'
  const row = (r: string[]) => '; ' + r.map((c, i) => c.padEnd(w[i])).join(' ; ') + ' ;'
  return ['+' + '-'.repeat(line.length - 2) + '+', '; ' + title.padEnd(Math.max(title.length, line.length - 4)) + ' ;', line, row(head), line, ...rows.map(row), line, ''].join('\n')
}

/** A Quartus path table as report_timing -file writes it. */
export const paths = (title: string, rows: Row[]) => table(title, ['Slack', 'From Node', 'To Node', 'Launch Clock', 'Latch Clock', 'Relationship', 'Clock Skew', 'Data Delay'],
  rows.map(r => [r.slack, r.from, r.to, r.launch ?? 'clk', r.latch ?? r.launch ?? 'clk', r.rel ?? '10.000', r.skew ?? '0.000', r.delay ?? '5.000']))
export const clocks = (list: [name: string, period: string][]) => table('Clocks', ['Clock Name', 'Type', 'Period', 'Frequency', 'Rise', 'Fall'], list.map(([n, p]) => [n, 'Base', p, '1 MHz', '0.000', '5.000']))
export const summary = (kind: string, list: [clock: string, slack: string, tns: string][]) => table(`Slow 1200mV 85C Model ${kind} Summary`, ['Clock', 'Slack', 'End Point TNS'], list)
export const unconstrained = (kind: 'Input' | 'Output', ports: string[]) => table(`Unconstrained ${kind} Ports`, [`${kind} Port`, 'Comment'], ports.map(p => [p, 'No delay']))

/**
 * The hand-worked report. One 10 ns clock.
 *   setup: s1 -2.000 and s2 -1.250 end at the same register, s3 -0.500 at another, s4 +3.000 met
 *   hold:  h1 -0.100, h2 +0.200
 * WNS -2.000. TNS counts each endpoint once: -2.000 + -0.500 = -2.500. Failing paths: 3 setup + 1 hold = 4 of 6.
 * Fmax = 1000 / (10 + 2) = 83.33 MHz. At Fmax every same-clock setup slack gains 2.0005 ns, so none fails and WNS is 0.000.
 */
export const HAND = clocks([['clk', '10.000']]) + '\n'
  + paths("Slow 1200mV 85C Model Setup: 'clk'", [
    { slack: '-2.000', from: 'u_a|x[0]', to: 'u_b|y[0]', delay: '11.900' },
    { slack: '-1.250', from: 'u_a|x[1]', to: 'u_b|y[0]', delay: '11.150' },
    { slack: '-0.500', from: 'u_a|x[1]', to: 'u_b|y[1]', delay: '10.400' },
    { slack: '3.000', from: 'u_c|x', to: 'u_d|y', delay: '6.900' },
  ]) + '\n'
  + paths("Fast 1200mV 0C Model Hold: 'clk'", [
    { slack: '-0.100', from: 'u_h|x', to: 'u_h|y', rel: '0.000', delay: '0.100', skew: '0.200' },
    { slack: '0.200', from: 'u_h|p', to: 'u_h|q', rel: '0.000', delay: '0.400' },
  ])

export const crossing = (slack = '-5.000') => clocks([['clkA', '10.000'], ['clkB', '8.000']]) + '\n' + paths('Setup: clkB', [{ slack, from: 'u_a|x', to: 'u_b|y', launch: 'clkA', latch: 'clkB' }])

/** Vivado report_timing_summary text: design totals, clock summary and one failing setup path with 9 logic levels. */
export const VIVADO = `| Tool Version      : Vivado v.2024.2 (lin64) Build 5239630
| Design            : hand_top
| Device            : 7a35t-csg324
| Design Timing Summary
| ---------------------

    WNS(ns)      TNS(ns)  TNS Failing Endpoints  TNS Total Endpoints      WHS(ns)      THS(ns)  THS Failing Endpoints  THS Total Endpoints
    -------      -------  ---------------------  -------------------      -------      -------  ---------------------  -------------------
     -1.500       -7.250                      9                  200        0.040        0.000                      0                  200

| Clock Summary
| -------------

Clock    Waveform(ns)         Period(ns)      Frequency(MHz)
-----    ------------         ----------      --------------
clk_in   {0.000 4.000}        8.000           125.000

| Timing Details
| --------------

Slack (VIOLATED) :        -1.500ns  (required time - arrival time)
  Source:                 u_a/x_reg[0]/C
                            (rising edge-triggered cell FDRE clocked by clk_in  {rise@0.000ns fall@4.000ns period=8.000ns})
  Destination:            u_b/y_reg[0]/D
                            (rising edge-triggered cell FDRE clocked by clk_in  {rise@0.000ns fall@4.000ns period=8.000ns})
  Path Group:             clk_in
  Path Type:              Setup (Max at Slow Process Corner)
  Requirement:            8.000ns  (clk_in rise@8.000ns - clk_in rise@0.000ns)
  Data Path Delay:        9.400ns  (logic 4.700ns (50.000%)  route 4.700ns (50.000%))
  Logic Levels:           9  (LUT6=9)
  Clock Path Skew:        -0.050ns (DCD - SCD + CPR)
  Clock Uncertainty:      0.050ns
`

export const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) })

/** New blank design on its Data tab. */
export async function newDesign(page: Page) {
  await page.goto('/app')
  await page.getByRole('button', { name: /^(Import your data|New design)$/ }).click()
  await expect(page.getByText('Drop report and constraint files')).toBeVisible()
}
export const choose = (page: Page, ...files: [name: string, text: string][]) => page.locator('input[type=file]').setInputFiles(files.map(f => file(...f)))
export const analyzeButton = (page: Page) => page.getByRole('button', { name: /^(Analyze \d+ report|Replace constraints)/ })

/** Imports files into a new design and waits for the overview. */
export async function importFiles(page: Page, ...files: [name: string, text: string][]) {
  await newDesign(page)
  await choose(page, ...files)
  await analyzeButton(page).click()
  await expect(page).toHaveURL(/\/app\/p\/[0-9a-f-]+$/)
}
export const kpi = (page: Page, label: string) => page.locator('.kpi', { has: page.locator('small', { hasText: label }) })
export const tab = async (page: Page, name: string) => { await page.getByRole('navigation', { name: 'Design sections' }).getByRole('link', { name, exact: true }).click() }

export async function setSdc(page: Page, text: string) {
  await tab(page, 'Constraints')
  await page.getByLabel('SDC constraints').fill(text)
  await page.getByRole('button', { name: 'Save & re-run' }).click()
  await expect(page.getByText('Constraints saved. Analysis re-ran.').first()).toBeVisible()
}
export async function exported(page: Page, button: string) {
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()])
  const stream = await d.createReadStream()
  let text = ''
  for await (const c of stream) text += c
  return { name: d.suggestedFilename(), text }
}
