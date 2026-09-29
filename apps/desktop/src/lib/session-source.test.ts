import { describe, expect, it } from 'vitest'

import { isMessagingSource, sessionSourceSearchTerms } from './session-source'

// Regression guard for #46761 / PR #47395: Photon (iMessage) must keep its own
// sidebar section. refreshMessagingSessions() filters rows through
// isMessagingSource(), so this entry is the sole condition that keeps Photon
// sessions out of generic recents. A silent removal would regress the feature
// with no test failure — these asserts pin the contract.
describe('photon messaging source registration', () => {
  it('treats photon as a messaging source (own sidebar section)', () => {
    expect(isMessagingSource('photon')).toBe(true)
  })

  it('is case/space insensitive on the source id', () => {
    expect(isMessagingSource('PHOTON')).toBe(true)
    expect(isMessagingSource('  photon ')).toBe(true)
  })

  it('exposes the iMessage/messages search aliases so Photon sessions are findable', () => {
    const terms = sessionSourceSearchTerms('photon')
    expect(terms).toContain('imessage')
    expect(terms).toContain('messages')
  })

  it('does not flag local/CLI-ish sources as messaging (guard sanity)', () => {
    expect(isMessagingSource('cli')).toBe(false)
    expect(isMessagingSource(null)).toBe(false)
    expect(isMessagingSource(undefined)).toBe(false)
  })
})

// imsg sessions (the iMessage self-chat control channel / one-shot handlers,
// HERMES_SESSION_SOURCE=imsg) live in the sidebar's own "iMessage" messaging
// section, mirroring photon: isMessagingSource() is the sole condition that
// keeps them out of generic recents, so this pins the contract.
describe('imsg messaging source registration', () => {
  it('treats imsg as a messaging source (own sidebar section)', () => {
    expect(isMessagingSource('imsg')).toBe(true)
  })

  it('is case/space insensitive on the source id', () => {
    expect(isMessagingSource('IMSG')).toBe(true)
    expect(isMessagingSource('  imsg ')).toBe(true)
  })

  it('labels imsg sessions as iMessage and exposes search aliases', () => {
    const terms = sessionSourceSearchTerms('imsg')
    expect(terms).toContain('imessage')
    expect(terms).toContain('messages')
  })
})
