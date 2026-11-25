import { analyzeButton, choose, crossing, expect, exported, HAND, importFiles, kpi, newDesign, paths, setSdc, tab, test, unconstrained, VIVADO } from './fixtures.ts'

const SAMPLES = [
  { name: /VGA text console/, badge: 'Synthetic', wns: '−2.447 ns', device: 'Cyclone V' },
  { name: /UART to VGA bridge/, badge: 'Synthetic', wns: '−1.711 ns', device: 'Vivado' },
  { name: /AVR CPU core/, badge: 'Public report', wns: '−14.744 ns', device: 'EP4CE22F17C6' },
  { name: /Red Pitaya DSP/, badge: 'Public report', wns: '−4.965 ns', device: '7z010-clg400' },
]
for (const s of SAMPLES) test(`sample opens: ${s.name.source}`, async ({ page }) => {
  await page.goto('/app')
  await page.getByRole('button', { name: s.name }).click()
  await expect(kpi(page, 'Setup WNS')).toContainText(s.wns)
  await expect(page.locator('.proj-head')).toContainText(s.badge)
  await expect(page.locator('main')).toContainText(new RegExp(s.device, 'i'))
  for (const t of ['Paths', 'Clocks & CDC', 'Constraints', 'Fixes', 'History', 'Data', 'Overview']) {
    await tab(page, t)
    await expect(page.locator('nav.tabs a[aria-current=page]')).toHaveText(t)
    await expect(page.locator('.proj-head + nav + *, .panel, .fix-card').first()).toBeVisible()
  }
})

test('published samples show the numbers printed in their reports', async ({ page }) => {
  await page.goto('/app?sample=red-pitaya')
  await expect(kpi(page, 'Failing endpoints')).toContainText('11,315') // 11,287 setup + 28 hold endpoints in the Design Timing Summary
  await page.goto('/app?sample=avr-cpu')
  await expect(page.locator('tr', { hasText: '1000 MHz default' })).toContainText('63.5')
})

test('hand-worked report: WNS, TNS, hold, failing count, Fmax and what-if', async ({ page }) => {
  await importFiles(page, ['hand.rpt', HAND])
  await expect(kpi(page, 'Setup WNS').locator('b')).toHaveText('−2.000 ns')
  await expect(kpi(page, 'Setup TNS').locator('b')).toHaveText('−2.500 ns')
  await expect(kpi(page, 'Failing paths').locator('b')).toHaveText('4')
  await expect(kpi(page, 'Failing paths')).toContainText('of 6 listed')
  await expect(kpi(page, 'Hold WNS').locator('b')).toHaveText('−0.100 ns')
  await expect(page.locator('.panel', { hasText: 'Target' }).locator('tbody tr')).toContainText(['clk100.00 MHz−2.000−2.500483.3 est.'])
  const whatif = page.locator('.panel', { hasText: 'Frequency what-if' })
  await expect(whatif.locator('dl')).toHaveText('Same-clock paths4Failing3WNS−2.000TNS−2.500')
  await whatif.getByRole('button', { name: 'Fmax (83.3)' }).click()
  await expect(whatif.locator('dl')).toHaveText('Same-clock paths4Failing0WNS0.000TNS0.000')
})

test('hand-worked crossing: set_clock_groups removes the only violation', async ({ page }) => {
  await importFiles(page, ['x.rpt', crossing() + paths('Setup: clkA', [{ slack: '1.500', from: 'u_a|p', to: 'u_a|q', launch: 'clkA' }])])
  await expect(kpi(page, 'Setup WNS')).toContainText('−5.000')
  await tab(page, 'Clocks & CDC')
  await expect(page.locator('.crossing')).toContainText('Unconstrained crossing')
  await setSdc(page, 'create_clock -name clkA -period 10 [get_ports a]\ncreate_clock -name clkB -period 8 [get_ports b]\nset_clock_groups -asynchronous -group [get_clocks clkA] -group [get_clocks clkB]\n')
  await tab(page, 'Overview')
  await expect(kpi(page, 'Setup WNS').locator('b')).toHaveText('1.500 ns')
  await expect(kpi(page, 'Failing paths')).toContainText('of 1 listed · 1 cut by SDC')
  await tab(page, 'Clocks & CDC')
  await expect(page.locator('.crossing')).toContainText('Cut (SDC line 3)')
})

test('Vivado report: totals, clock and logic-depth cause', async ({ page }) => {
  await importFiles(page, ['timing_summary.rpt', VIVADO])
  await expect(kpi(page, 'Setup WNS').locator('b')).toHaveText('−1.500 ns')
  await expect(kpi(page, 'Setup TNS').locator('b')).toHaveText('−7.250 ns')
  await expect(kpi(page, 'Failing endpoints')).toContainText('of 200 in the design')
  await expect(kpi(page, 'Hold WNS').locator('b')).toHaveText('0.040 ns')
  await expect(page.getByRole('button', { name: /Logic depth/ })).toBeVisible()
  await tab(page, 'Fixes')
  await expect(page.getByRole('heading', { name: 'Pipeline u_b/y_reg[*] (9 levels of logic)' })).toBeVisible()
})

test('paste import reports bad rows with their line number', async ({ page }) => {
  await newDesign(page)
  await page.getByLabel('Or paste report or SDC text').fill(paths('Setup: clk', [{ slack: '-1.000', from: 'u|a', to: 'u|b' }, { slack: 'n/a', from: 'u|c', to: 'u|d' }]))
  await page.getByRole('button', { name: 'Check pasted text' }).click()
  await expect(page.locator('.validation')).toContainText('1 paths (1 negative slack)')
  await expect(page.locator('.issues')).toContainText(/line 7.*Skipped a path row/)
  await analyzeButton(page).click()
  await expect(kpi(page, 'Setup WNS')).toContainText('−1.000')
})

for (const [name, text] of [['empty', ''], ['plain text', 'hello world, not a report'], ['HTML', '<html><body><table><tr><td>Slack</td></tr></table></body></html>'], ['CSV', 'slack,from,to\n-1.0,a,b\n'], ['binary', '\u0000\u0001\u0002PK\u0003\u0004']] as const) test(`wrong file is refused: ${name}`, async ({ page }) => {
  await newDesign(page)
  await choose(page, ['wrong.rpt', text])
  await expect(page.locator('.validation.bad')).toContainText('Not a recognised timing report')
  await expect(page.getByText('Nothing usable yet')).toBeVisible()
  await expect(analyzeButton(page)).toBeDisabled()
  await page.reload()
  await expect(page.getByText('Nothing imported yet')).toBeVisible()
})

test('a Quartus file cut off before its first row is marked bad', async ({ page }) => {
  await newDesign(page)
  await choose(page, ['cut.rpt', paths('Setup: clk', [{ slack: '-1.000', from: 'u|a', to: 'u|b' }]).split('\n').slice(0, 4).join('\n')])
  await expect(page.locator('.validation.bad')).toContainText('Found Quartus tables but none with paths')
})

test('BOM and CRLF files import the same numbers', async ({ page }) => {
  await importFiles(page, ['hand.rpt', '﻿' + HAND.replace(/\n/g, '\r\n')])
  await expect(kpi(page, 'Setup TNS').locator('b')).toHaveText('−2.500 ns')
  await expect(kpi(page, 'Hold WNS').locator('b')).toHaveText('−0.100 ns')
})

test('markup in node names is shown as text', async ({ page }) => {
  await importFiles(page, ['x.rpt', paths('Setup: clk', [{ slack: '-1.000', from: 'u|<img src=x onerror=alert(1)>', to: 'u|b', delay: '11.000' }])])
  await tab(page, 'Paths')
  await expect(page.locator('table.paths')).toContainText('<img src=x onerror=alert(1)>')
  await expect(page.locator('table.paths img')).toHaveCount(0)
  await page.getByRole('link', { name: 'Closure report' }).click()
  await expect(page.locator('article.report')).toContainText('<img src=x')
  await expect(page.locator('article.report img')).toHaveCount(0)
})

test('paths: search, filter, group and detail', async ({ page }) => {
  await importFiles(page, ['hand.rpt', HAND])
  await tab(page, 'Paths')
  await expect(page.locator('table.paths tbody tr')).toHaveCount(4)
  await page.getByLabel('Show').selectOption('all')
  await expect(page.locator('table.paths tbody tr')).toHaveCount(6)
  await page.getByLabel('Analysis').selectOption('hold')
  await expect(page.locator('table.paths tbody tr')).toHaveCount(2)
  await page.getByLabel('Analysis').selectOption('all')
  await page.getByLabel(/Search nodes/).fill('y[0]')
  await expect(page.locator('table.paths tbody tr')).toHaveCount(2)
  await page.getByLabel(/Search nodes/).fill('')
  await page.getByRole('radio', { name: 'Register bus' }).click()
  await expect(page.locator('details.group').first()).toContainText('u_a|x[*] → u_b|y[*]')
  await expect(page.locator('details.group').first()).toContainText('TNS −2.500')
  await page.locator('table.paths tbody tr').first().click()
  await expect(page.getByRole('dialog', { name: 'Path detail' })).toContainText('-from [get_keepers {u_a|x[0]}] -to [get_keepers {u_b|y[0]}]')
})

test('exports: paths CSV, fixes.sdc, constraints and JSON', async ({ page }) => {
  await importFiles(page, ['x.rpt', crossing()], ['my.sdc', 'create_clock -name clkA -period 10 [get_ports a]\n'])
  await tab(page, 'Paths')
  const csv = await exported(page, 'Export CSV')
  expect(csv.name).toBe('timing-paths.csv')
  expect(csv.text.split('\n').slice(0, 2)).toEqual([
    'analysis,slack_ns,from,to,launch_clock,latch_clock,relationship_ns,clock_skew_ns,data_delay_ns,logic_levels,max_fanout,root_cause,cut_by_sdc_line,source_line',
    'setup,-5,u_a|x,u_b|y,clkA,clkB,10,0,5,,,Unconstrained CDC,,15',
  ])
  await tab(page, 'Fixes')
  const fixes = await exported(page, 'Download fixes.sdc')
  expect(fixes.text).toContain('set_clock_groups -asynchronous \\\n  -group [get_clocks {clkA}] \\\n  -group [get_clocks {clkB}]')
  await tab(page, 'Constraints')
  const sdc = await exported(page, 'Download')
  expect(sdc).toEqual({ name: 'my.sdc', text: 'create_clock -name clkA -period 10 [get_ports a]\n' })
  await page.goto('/settings')
  const json = JSON.parse((await exported(page, 'Export all my data (JSON)')).text)
  expect(json.projects).toHaveLength(1)
  expect(json.projects[0].dataset[0].name).toBe('x.rpt')
  expect(json.projects[0].snapshots[0].wns).toBe(-5)
})

test('apply a fix, undo it, apply again and reload', async ({ page }) => {
  await importFiles(page, ['x.rpt', crossing()])
  await tab(page, 'Fixes')
  const card = page.locator('.fix-card', { hasText: 'Declare clkA and clkB asynchronous' })
  await card.getByRole('button', { name: 'Apply & re-run' }).click()
  await expect(page.locator('.toasts')).toContainText('1 → 0 failing')
  await page.locator('.toasts').getByRole('button', { name: 'Undo' }).click()
  await expect(card).toBeVisible()
  await tab(page, 'Constraints')
  await expect(page.getByLabel('SDC constraints')).toHaveValue('')
  await tab(page, 'Fixes')
  await card.getByRole('button', { name: 'Apply & re-run' }).click()
  await expect(card).toBeHidden()
  await page.reload()
  await tab(page, 'Constraints')
  await expect(page.getByLabel('SDC constraints')).toHaveValue(/set_clock_groups -asynchronous/)
})

test('lint: frequency typed as period, and the fix button', async ({ page }) => {
  await importFiles(page, ['hand.rpt', HAND])
  await setSdc(page, 'create_clock -name clk_50 -period 50 [get_ports clk]\nset_false_path -from *\n')
  await expect(page.locator('.lint')).toContainText('A 50 MHz clock has a period of 20.000 ns.')
  await expect(page.locator('.lint')).toContainText('Overly broad false path')
  await page.locator('.lint li', { hasText: 'derive_clock_uncertainty' }).getByRole('button', { name: 'Add' }).click()
  await expect(page.getByLabel('SDC constraints')).toHaveValue(/derive_clock_uncertainty/)
})

test('unconstrained ports are listed until the SDC constrains them', async ({ page }) => {
  await importFiles(page, ['x.rpt', HAND + '\n' + unconstrained('Input', ['sw[0]', 'sw[1]'])])
  await expect(page.locator('.banner')).toContainText('2 I/O ports are not constrained')
  await setSdc(page, 'set_input_delay -clock clk -max 2 [get_ports {sw[*]}]\nset_input_delay -clock clk -min 0 [get_ports {sw[*]}]')
  await tab(page, 'Overview')
  await expect(page.getByText(/not constrained, so/)).toHaveCount(0)
})

test('history: two runs compare, and everything survives a reload', async ({ page }) => {
  await importFiles(page, ['one.rpt', HAND])
  await tab(page, 'Data')
  await choose(page, ['two.rpt', HAND.replace('; -2.000 ', '; -0.250 ').replace('; -1.250 ', ';  1.250 ')])
  await page.getByLabel('Run name').fill('After pipelining')
  await analyzeButton(page).click()
  await expect(kpi(page, 'Setup WNS').locator('b')).toHaveText('−0.500 ns')
  await page.reload()
  await expect(kpi(page, 'Setup WNS').locator('b')).toHaveText('−0.500 ns')
  await tab(page, 'History')
  await expect(kpi(page, 'WNS change')).toContainText('+1.500 ns') // -0.500 - -2.000
  await expect(kpi(page, 'TNS change')).toContainText('+1.75 ns') // (-0.250 - 0.500) - -2.500
  await expect(kpi(page, 'Failing paths')).toContainText('4 → 3')
  await page.goto('/app')
  await expect(page.locator('.project-card')).toContainText('Runs2')
})

test('closure report repeats the headline numbers', async ({ page }) => {
  await importFiles(page, ['hand.rpt', HAND])
  await page.getByRole('link', { name: 'Closure report' }).click()
  await expect(page.locator('article.report .kpis')).toContainText('Setup WNS−2.000 ns')
  await expect(page.locator('article.report .kpis')).toContainText('Failing paths4of 6 listed')
  await expect(page.getByRole('heading', { name: 'Fix list' })).toBeVisible()
})

test('rename, delete and undo a design', async ({ page }) => {
  await importFiles(page, ['hand.rpt', HAND])
  await page.goto('/app')
  await page.getByRole('button', { name: 'Rename' }).click()
  await page.getByLabel('Design name').fill('Alpha')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('link', { name: 'Alpha' })).toBeVisible()
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Delete design' }).click()
  await expect(page.locator('.project-card')).toHaveCount(0)
  await page.locator('.toasts').getByRole('button', { name: 'Undo' }).click()
  await page.getByRole('link', { name: 'Alpha' }).click()
  await expect(kpi(page, 'Setup WNS').locator('b')).toHaveText('−2.000 ns')
})

test('settings: a new design uses the saved thresholds', async ({ page }) => {
  await page.goto('/settings')
  await page.getByLabel('Include hold paths').uncheck()
  await page.reload()
  await expect(page.getByLabel('Include hold paths')).not.toBeChecked()
  await importFiles(page, ['hand.rpt', HAND])
  await expect(kpi(page, 'Failing paths').locator('b')).toHaveText('3')
  await expect(kpi(page, 'Hold WNS').locator('b')).toHaveText('—')
})

test('landing, docs, unknown pages and unknown designs', async ({ page, outside }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Open the app' }).first().click()
  await expect(page.getByRole('heading', { name: 'Designs' })).toBeVisible()
  await page.goto('/docs')
  await expect(page.locator('main')).toContainText('report_timing')
  await page.goto('/nope')
  await expect(page.getByText('This page does not exist')).toBeVisible()
  await page.goto('/app/p/00000000-0000-0000-0000-000000000000')
  await expect(page.getByText('Design not found')).toBeVisible()
  expect(outside.length).toBeGreaterThan(0) // the web font was requested and blocked
})
