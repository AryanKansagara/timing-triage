// Known bugs. Each test states the correct behaviour and is marked test.fail until its issue is fixed.
import { analyzeButton, choose, clocks, crossing, expect, exported, HAND, importFiles, kpi, newDesign, paths, setSdc, summary, tab, test, unconstrained } from './fixtures.ts'

test('#2 a report with no timing data cannot replace a good one', async ({ page }) => {
  await importFiles(page, ['hand.rpt', HAND])
  await tab(page, 'Data')
  await choose(page, ['cut.rpt', '| Tool Version      : Vivado v.2024.2 (lin64)\n'])
  await expect(page.locator('.validation.bad')).toBeVisible()
  await expect(analyzeButton(page)).toBeDisabled()
})

test('#3 a clock table alone is not a met design', async ({ page }) => {
  await importFiles(page, ['clocks.rpt', clocks([['clk', '10.000']])])
  await expect(page.getByText('Setup slack distribution')).toBeVisible()
  await expect(kpi(page, 'Setup WNS').locator('b')).toHaveText('—')
  await expect(page.locator('main')).not.toContainText('Timing is met')
})

test('#3 a failing summary without path tables is not called met', async ({ page }) => {
  await importFiles(page, ['sum.rpt', clocks([['clk', '10.000']]) + '\n' + summary('Setup', [['clk', '-5.000', '-20.000']])])
  await expect(kpi(page, 'Setup WNS').locator('b')).toHaveText('−5.000 ns')
  await expect(page.locator('main')).not.toContainText('Timing is met')
})

test('#3 a hold-only report does not claim setup is met, and its saved run stays unknown', async ({ page }) => {
  await importFiles(page, ['hold.rpt', paths("Hold: 'clk'", [{ slack: '0.200', from: 'u|a', to: 'u|b', rel: '0.000' }])])
  await expect(kpi(page, 'Hold WNS').locator('b')).toHaveText('0.200 ns')
  await expect(kpi(page, 'Setup WNS').locator('b')).toHaveText('—')
  await expect(page.locator('main')).not.toContainText(/Setup met|Timing is met/)
  await page.goto('/app')
  await expect(page.locator('.project-card')).toContainText('WNS—TNS—')
})

for (const [why, sdc] of [
  ['-hold only', 'set_false_path -hold -from [get_clocks clkA] -to [get_clocks clkB]'],
  ['-through', 'set_false_path -from [get_clocks clkA] -through [get_pins zz]'],
  ['-rise_from another clock', 'set_false_path -rise_from [get_clocks other] -to [get_clocks clkB]'],
]) test(`#4 a false path limited by ${why} does not hide a setup violation`, async ({ page }) => {
  await importFiles(page, ['x.rpt', crossing()])
  await setSdc(page, sdc)
  await tab(page, 'Overview')
  await expect(kpi(page, 'Setup WNS').locator('b')).toHaveText('−5.000 ns')
})

test('#5 a half-cycle path keeps half of the new period when re-timed', async ({ page }) => {
  // Needs 0.5 + 14.7 = 15.2 ns; half of 20 ns is 10 ns; slack -5.2 ns.
  const msg = 'Info (332105): Deriving Clocks\nInfo (332105): create_clock -period 1.000 -name clk clk\nCritical Warning (332148): Timing requirements not met\n'
  await importFiles(page, ['x.sta.rpt', clocks([['clk', '1.000']]) + '\n' + paths("Slow Model Setup: 'clk'", [{ slack: '-14.700', from: 'u|a', to: 'u|b', rel: '0.500', delay: '15.200' }]) + '\n' + msg])
  await expect(page.locator('.banner').first()).toContainText('no clock constraint')
  await setSdc(page, 'create_clock -name clk -period 20.000 [get_ports clk]')
  await tab(page, 'Overview')
  await expect(kpi(page, 'Setup WNS').locator('b')).toHaveText('−5.200 ns')
})

test('#6 the worst corner wins when two files list the same path', async ({ page }) => {
  const p = (slack: string) => paths('Setup: clk', [{ slack, from: 'u|a', to: 'u|b' }])
  await importFiles(page, ['fast.rpt', p('3.000')], ['slow.rpt', p('-1.500')])
  await expect(kpi(page, 'Setup WNS').locator('b')).toHaveText('−1.500 ns')
})

for (const [form, sdc] of [
  ['-include_generated_clocks', 'set_clock_groups -asynchronous -group [get_clocks -include_generated_clocks clkA] -group [get_clocks clkB]'],
  ['[list]', 'set_clock_groups -asynchronous -group [get_clocks [list clkA]] -group [get_clocks clkB]'],
  ['multi-line braces', 'set_clock_groups -asynchronous -group [get_clocks {\n  clkA\n}] -group [get_clocks {\n  clkB\n}]'],
]) test.fail(`#7 clock groups written with ${form} are honoured`, async ({ page }) => {
  await importFiles(page, ['x.rpt', crossing()])
  await setSdc(page, sdc)
  await tab(page, 'Clocks & CDC')
  await expect(page.locator('.crossing')).toContainText('Cut (SDC line 1)')
})

test.fail('#7 [all_inputs] constrains the input ports', async ({ page }) => {
  await importFiles(page, ['x.rpt', HAND + '\n' + unconstrained('Input', ['sw[0]'])])
  await setSdc(page, 'set_input_delay -clock clk 2 [all_inputs]')
  await tab(page, 'Overview')
  await expect(kpi(page, 'Setup WNS')).toBeVisible()
  await expect(page.getByText(/not constrained, so/)).toHaveCount(0)
})

test('#8 a Unicode minus is still negative', async ({ page }) => {
  await importFiles(page, ['x.rpt', paths('Setup: clk', [{ slack: '−1.234', from: 'u|a', to: 'u|b' }])])
  await expect(kpi(page, 'Setup WNS').locator('b')).toHaveText('−1.234 ns')
})

test('#8 a report cut off in its last row says rows are missing', async ({ page }) => {
  await newDesign(page)
  const t = paths('Setup: clk', [{ slack: '2.000', from: 'u|a', to: 'u|b' }, { slack: '-4.000', from: 'u|c', to: 'u|d' }])
  await choose(page, ['cut.rpt', t.slice(0, t.indexOf('-4.000') + 10)])
  await expect(page.locator('.validation')).toContainText('1 paths')
  await expect(page.locator('.issues')).toContainText(/cut off/)
})

test('#9 recovery and removal summaries count', async ({ page }) => {
  await importFiles(page, ['x.rpt', clocks([['clk', '10.000']]) + '\n' + summary('Setup', [['clk', '1.000', '0.000']]) + '\n' + summary('Recovery', [['clk', '-3.200', '-40.000']])])
  await expect(kpi(page, 'Setup WNS').locator('b')).toHaveText('−3.200 ns')
})

test.fail('#10 a node name cannot become a spreadsheet formula', async ({ page }) => {
  await importFiles(page, ['x.rpt', paths('Setup: clk', [{ slack: '-1.000', from: '=HYPERLINK(1)', to: 'u|b' }])])
  await tab(page, 'Paths')
  expect((await exported(page, 'Export CSV')).text).not.toMatch(/(^|,)"?=/m)
})

test.fail('#11 two constraint files are both used', async ({ page }) => {
  await importFiles(page, ['x.rpt', crossing()], ['a.sdc', 'create_clock -name clkA -period 10 [get_ports a]\n'], ['b.sdc', 'create_clock -name clkB -period 8 [get_ports b]\n'])
  await tab(page, 'Constraints')
  await expect(page.getByLabel('SDC constraints')).toHaveValue(/clkA[\s\S]*clkB/)
})

test.fail('#12 hsync is not a synchronizer', async ({ page }) => {
  await importFiles(page, ['x.rpt', crossing().replace('u_b|y', 'u_v|hsync')])
  await tab(page, 'Clocks & CDC')
  await expect(page.locator('.sync-list')).toContainText('needs a two-flop synchronizer')
})

test.fail('#13 a top-level counter is not I/O', async ({ page }) => {
  await importFiles(page, ['x.rpt', clocks([['clk', '10.000']]) + '\n' + paths('Setup: clk', [{ slack: '-1.000', from: 'cnt[0]', to: 'cnt[25]', delay: '11.000' }])])
  await expect(page.getByRole('button', { name: /Logic depth/ })).toBeVisible()
})

test.fail('#14 endpoints past the stored limit are not reported as new', async ({ page }) => {
  const many = (from: number) => paths('Setup: clk', Array.from({ length: 500 - from }, (_, i) => ({ slack: (-6 + (i + from) / 100).toFixed(3), from: 'u|a', to: `u|r${i + from}` })))
  await importFiles(page, ['one.rpt', many(0)])
  await tab(page, 'Data')
  await choose(page, ['two.rpt', many(100)])
  await analyzeButton(page).click()
  await expect(kpi(page, 'Failing paths').locator('b')).toHaveText('400')
  await tab(page, 'History')
  await expect(page.getByText(/\d+ fixed/)).toBeVisible()
  await expect(page.getByText(/\b100 new/)).toHaveCount(0)
})
