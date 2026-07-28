import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ContactsScreen } from './ContactsScreen'

describe('ContactsScreen', () => {
  it('imports Farcaster follows and reports XMTP reachability', async () => {
    const onImportFollows = vi.fn().mockResolvedValue({
      imported: 3,
      nextCursor: 'next',
      skipped: 2,
    })
    render(
      <ContactsScreen
        contacts={[]}
        importing={false}
        offline={false}
        onBack={vi.fn()}
        onImportFollows={onImportFollows}
        onMessage={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', {
      name: 'Import Farcaster follows',
    }))

    await waitFor(() => expect(onImportFollows).toHaveBeenCalledOnce())
    expect(screen.getByRole('status')).toHaveTextContent(
      'Imported 3 XMTP contacts; 2 follows had no reachable XMTP inbox. Import again for the next page.',
    )
  })

  it('renders the interoperable profile name as the contact label', () => {
    render(
      <ContactsScreen
        contacts={[{
          address: '0x2222222222222222222222222222222222222222',
          avatarUrl: null,
          conversationId: 'dm-1',
          displayName: 'Alice in Convos',
          fid: 10,
          inboxId: 'bb'.repeat(32),
          source: 'convos-profile',
          updatedAt: 1,
          username: 'alice',
        }]}
        importing={false}
        offline={false}
        onBack={vi.fn()}
        onImportFollows={vi.fn()}
        onMessage={vi.fn()}
      />,
    )

    expect(screen.getByText('Alice in Convos')).toBeVisible()
    expect(screen.getByText(/@alice/u)).toBeVisible()
  })
})
