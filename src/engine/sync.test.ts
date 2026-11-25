import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze } from './analyze.ts'
import { buildFixes } from './fixes.ts'
import type { ParsedReport } from './types.ts'

const run = (...to: string[]) => analyze({ report: { format: 'quartus', paths: to.map((t, i) => ({ id: `p${i}`, analysis: 'setup', slack: -1, from: 'u_a|x', to: t, launch: 'clkA', latch: 'clkB', line: 1 })), clocks: [{ name: 'clkA', period: 10 }, { name: 'clkB', period: 8 }], summary: [], unconstrained: [], transfers: [], issues: [], found: [] } satisfies ParsedReport })
const synced = (...to: string[]) => run(...to).crossings[0].toBuses.map(b => b.synchronized)

test('video syncs, async and metadata are not synchronizers', () => {
  for (const n of ['u_vga|hsync', 'u_vga|vsync_reg', 'u_vga|csync', 'u|async_data[0]', 'u|async_flag', 'u|HSYNC', 'u|h_sync', 'u|hSync', 'u|HSync_q', 'u|vga_sync', 'u_vga|sync_reg', 'vga_sync:u|hcount', 'u|frame_sync', 'u|sync_gen', 'u|metadata', 'u|meta_data', 'usb_cdc:u|tx', 'u|status_reg1', 'u|buff1', 'u|diff1']) assert.deepEqual(synced(n), [false], n)
})

test('synchronizer stages are still recognised', () => {
  for (const n of ['u|busy_meta', 'u|rx_sync', 'u|rx_sync1', 'u|rxSync', 'u|sync_ff1', 'u|data_ff2', 'u|sync_reg[0]', 'u|s_reg1', 'u|sreg_sync', 'altera_std_synchronizer:u|dreg[0]', 'u_sync/q_reg/D', 'u/xpm_cdc_single_inst/syncstages_ff_reg[0]/D', 'u|hsync_sync_ff1', 'u|dff1', 'u|resync', 'u|meta1', 'u|metastable', 'rst_sync:u_rst|q']) assert.deepEqual(synced(n), [true], n)
})

test('a multi-bit bus is never called synchronized', () => {
  const bits = (n: number) => Array.from({ length: n }, (_, i) => `u_x|data_sync[${i}]`)
  assert.deepEqual(synced(...bits(8)), [false])
  assert.deepEqual(synced(...bits(2)), [false])
  assert.deepEqual(synced('u_x|data_sync[7]'), [false])
  const r = run(...bits(8))
  const steps = buildFixes(r, r.clockDefs).find(f => f.cause === 'cdc')!.steps.join()
  assert.match(steps, /8 bits cross together/)
  assert.doesNotMatch(steps, /Keep it and cut/)
})
