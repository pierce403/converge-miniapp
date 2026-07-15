import { describe, expect, it } from 'vitest'

import { conversationTime, shortIdentity } from './format'

describe('messaging formatters', () => {
  it('shortens long identities without changing short labels', () => {
    expect(shortIdentity('0x1234567890abcdef')).toBe('0x1234…cdef')
    expect(shortIdentity('alice')).toBe('alice')
  })

  it('uses a time for today and a date for older messages', () => {
    const now = new Date(2026, 6, 14, 15, 0)
    expect(conversationTime(new Date(2026, 6, 14, 14, 30), now)).toMatch(/2:30/)
    expect(conversationTime(new Date(2026, 6, 12, 14, 30), now)).toMatch(/Jul/)
  })
})
