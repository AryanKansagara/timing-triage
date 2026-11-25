import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSdc } from './engine/sdc.ts'
import { combineSdc } from './projectData.ts'

const A = 'create_clock -name clkA -period 10 [get_ports a]', B = 'create_clock -name clkB -period 8 [get_ports b]'
const names = (...f: [string, string][]) => parseSdc(combineSdc(f.map(([name, text]) => ({ name, text })))!.text).clocks.map(c => c.name)

test('one file is kept exactly, none is null', () => {
  assert.equal(combineSdc([]), null)
  assert.deepEqual(combineSdc([{ name: 'a.sdc', text: A + '\r\n\r\n' }]), { name: 'a.sdc', text: A + '\r\n\r\n' })
})

test('several files are joined in order under their names', () => {
  const c = combineSdc([{ name: 'clocks.xdc', text: A }, { name: 'exceptions.xdc', text: B }])!
  assert.equal(c.name, 'constraints.xdc')
  assert.equal(c.text, `# File: clocks.xdc\n${A}\n\n# File: exceptions.xdc\n${B}\n`)
})

test('one file cannot swallow the start of the next', () => {
  assert.deepEqual(names(['a.sdc', A + ' \\'], ['b.sdc', B]), ['clkA', 'clkB'])
  assert.deepEqual(names(['a.sdc', '# {'], ['b.sdc\\', B]), ['clkB'])
  assert.deepEqual(names(['a.sdc', A], ['b{.sdc', B]), ['clkA', 'clkB'])
  assert.deepEqual(names(['a.sdc', 'foo {'], ['b.sdc', B]), ['clkB'])
})
