import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getOverlayState, resetOverlayState } from '../app/overlayStore.js'
import { findSlashCommand } from '../app/slash/registry.js'
import type { SlashRunCtx } from '../app/slash/types.js'
import { emitStarjourneyNavigation, STARJOURNEY_NAV_OSC } from '../lib/starjourneyNav.js'

const ctxWithSys = (sys: (text: string) => void): SlashRunCtx =>
  ({ transcript: { sys } }) as unknown as SlashRunCtx

describe('/starjourney slash command', () => {
  beforeEach(() => {
    resetOverlayState()
    delete process.env.HERMES_DASHBOARD_ORIGIN
  })

  afterEach(() => {
    delete process.env.HERMES_DASHBOARD_ORIGIN
    vi.restoreAllMocks()
  })

  it('resolves by name', () => {
    expect(findSlashCommand('starjourney')?.name).toBe('starjourney')
  })

  it('stays distinct from /journey — never opens the timeline overlay', () => {
    process.env.HERMES_DASHBOARD_ORIGIN = 'http://127.0.0.1:9119'
    findSlashCommand('starjourney')!.run('', ctxWithSys(() => {}), 'starjourney')
    expect(getOverlayState().journey).toBe(false)
  })

  it('prints the star-map link under the dashboard PTY (trailing slash trimmed)', () => {
    process.env.HERMES_DASHBOARD_ORIGIN = 'http://127.0.0.1:9119/'
    const sys = vi.fn()
    findSlashCommand('starjourney')!.run('', ctxWithSys(sys), 'starjourney')
    expect(sys).toHaveBeenCalledWith('➜ Star map: http://127.0.0.1:9119/starjourney')
  })

  it('explains where the page lives in a plain terminal (no dashboard origin)', () => {
    const sys = vi.fn()
    findSlashCommand('starjourney')!.run('', ctxWithSys(sys), 'starjourney')
    expect(sys).toHaveBeenCalledTimes(1)
    expect(sys.mock.calls[0][0]).toContain('hermes dashboard')
    expect(getOverlayState().journey).toBe(false)
  })
})

describe('/recall slash command', () => {
  beforeEach(() => {
    resetOverlayState()
    delete process.env.HERMES_DASHBOARD_ORIGIN
  })

  afterEach(() => {
    delete process.env.HERMES_DASHBOARD_ORIGIN
    vi.restoreAllMocks()
  })

  it('resolves by name (web parity with the desktop GUI /recall)', () => {
    expect(findSlashCommand('recall')?.name).toBe('recall')
  })

  it('never opens the timeline overlay', () => {
    process.env.HERMES_DASHBOARD_ORIGIN = 'http://127.0.0.1:9119'
    findSlashCommand('recall')!.run('', ctxWithSys(() => {}), 'recall')
    expect(getOverlayState().journey).toBe(false)
  })

  it('prints the recall link (?recall=1) under the dashboard PTY', () => {
    process.env.HERMES_DASHBOARD_ORIGIN = 'http://127.0.0.1:9119/'
    const sys = vi.fn()
    findSlashCommand('recall')!.run('', ctxWithSys(sys), 'recall')
    expect(sys).toHaveBeenCalledWith(
      '➜ Star map recall: http://127.0.0.1:9119/starjourney?recall=1'
    )
  })

  it('explains where recall lives in a plain terminal (no dashboard origin)', () => {
    const sys = vi.fn()
    findSlashCommand('recall')!.run('', ctxWithSys(sys), 'recall')
    expect(sys).toHaveBeenCalledTimes(1)
    expect(sys.mock.calls[0][0]).toContain('hermes dashboard')
    expect(getOverlayState().journey).toBe(false)
  })
})

describe('emitStarjourneyNavigation', () => {
  it('writes a stamped OSC sequence (`<ts>;<nonce>;<url>`) to a TTY stream', () => {
    const write = vi.fn().mockReturnValue(true)
    const before = Date.now()
    const ok = emitStarjourneyNavigation('http://127.0.0.1:9119/', { isTTY: true, write })
    expect(ok).toBe(true)
    expect(write).toHaveBeenCalledTimes(1)
    const seq = write.mock.calls[0][0] as string

    const m = seq.match(
      new RegExp(`^\\x1b\\]${STARJOURNEY_NAV_OSC};(\\d+);([a-z0-9]+);(.+)\\x07$`)
    )

    expect(m).not.toBeNull()
    // Replay guard inputs: a current timestamp + a nonce + the exact URL.
    expect(Number(m![1])).toBeGreaterThanOrEqual(before)
    expect(Number(m![1])).toBeLessThanOrEqual(Date.now())
    expect(m![2].length).toBeGreaterThan(0)
    expect(m![3]).toBe('http://127.0.0.1:9119/starjourney')
  })

  it('mints a fresh nonce per emission (replays must be distinguishable)', () => {
    const write = vi.fn().mockReturnValue(true)
    const stream = { isTTY: true, write }
    emitStarjourneyNavigation('http://x', stream)
    emitStarjourneyNavigation('http://x', stream)

    const nonceOf = (call: unknown[]) =>
      (call[0] as string).split(';')[2]

    expect(nonceOf(write.mock.calls[0])).not.toBe(nonceOf(write.mock.calls[1]))
  })

  it('is a no-op off a TTY', () => {
    const write = vi.fn()
    expect(emitStarjourneyNavigation('http://127.0.0.1:9119', { isTTY: false, write })).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('is a no-op for an empty origin', () => {
    const write = vi.fn()
    expect(emitStarjourneyNavigation('   ', { isTTY: true, write })).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('survives a stream that throws', () => {
    const write = vi.fn(() => {
      throw new Error('boom')
    })

    expect(emitStarjourneyNavigation('http://x', { isTTY: true, write })).toBe(false)
  })
})
