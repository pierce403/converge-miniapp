import {
  ArrowLeft,
  Download,
  MessageCircle,
  Users,
} from 'lucide-react'
import { useState } from 'react'

import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/Button'
import { shortIdentity } from '../messaging/format'
import type { Contact, ContactImportResult } from '../messaging/types'

type ContactsScreenProps = {
  contacts: Contact[]
  importing: boolean
  offline: boolean
  onBack: () => void
  onImportFollows: () => Promise<ContactImportResult | null>
  onMessage: (contact: Contact) => Promise<void> | void
}

export function ContactsScreen({
  contacts,
  importing,
  offline,
  onBack,
  onImportFollows,
  onMessage,
}: ContactsScreenProps) {
  const [status, setStatus] = useState<string | null>(null)

  const importFollows = async () => {
    setStatus(null)
    try {
      const result = await onImportFollows()
      if (!result) return
      const more = result.nextCursor ? ' Import again for the next page.' : ''
      setStatus(
        `Imported ${result.imported} XMTP contact${result.imported === 1 ? '' : 's'}; ` +
        `${result.skipped} follow${result.skipped === 1 ? '' : 's'} had no reachable XMTP inbox.${more}`,
      )
    } catch (error) {
      setStatus(error instanceof Error
        ? error.message
        : 'Farcaster contacts could not be imported.')
    }
  }

  return (
    <section className="messaging-screen contacts-screen" aria-labelledby="contacts-title">
      <header className="screen-header screen-header--conversation">
        <button className="icon-button" type="button" onClick={onBack} aria-label="Back to inbox">
          <ArrowLeft aria-hidden="true" />
        </button>
        <span className="contacts-screen__icon"><Users aria-hidden="true" /></span>
        <div>
          <p className="eyebrow">On-device directory</p>
          <h1 id="contacts-title">Contacts</h1>
          <span>{contacts.length} XMTP contact{contacts.length === 1 ? '' : 's'}</span>
        </div>
      </header>

      <div className="contacts-screen__import">
        <div>
          <strong>Bring in people you follow</strong>
          <span>
            Farcaster names are matched through verified EVM addresses. Only people with a reachable XMTP inbox are saved.
          </span>
        </div>
        <Button
          busy={importing}
          disabled={offline}
          onClick={() => void importFollows()}
          variant="secondary"
        >
          <Download aria-hidden="true" />
          Import Farcaster follows
        </Button>
      </div>

      {status ? <p className="contacts-screen__status" role="status">{status}</p> : null}

      {contacts.length ? (
        <ul className="contact-list">
          {contacts.map((contact) => {
            const label = contact.displayName ?? (
              contact.username ? `@${contact.username}` : shortIdentity(contact.address)
            )
            const secondary = [
              contact.username && `@${contact.username}`,
              shortIdentity(contact.address),
            ].filter((value, index, values) =>
              Boolean(value) && values.indexOf(value) === index).join(' · ')
            return (
              <li key={contact.inboxId}>
                <button
                  className="contact-row"
                  disabled={offline && !contact.conversationId}
                  onClick={() => void onMessage(contact)}
                  type="button"
                >
                  <Avatar name={label.replace(/^@/u, '')} src={contact.avatarUrl ?? undefined} />
                  <span>
                    <strong>{label}</strong>
                    <small>{secondary}</small>
                  </span>
                  <MessageCircle aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="empty-inbox">
          <span className="empty-inbox__icon"><Users aria-hidden="true" /></span>
          <h2>No contacts yet</h2>
          <p>
            People you message appear here. You can also import Farcaster follows who already have an XMTP inbox.
          </p>
        </div>
      )}
    </section>
  )
}
