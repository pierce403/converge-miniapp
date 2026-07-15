import type { ReactNode } from 'react'

type StatePanelProps = {
  busy?: boolean
  description: string
  eyebrow: string
  icon?: ReactNode
  title: string
}

export function StatePanel({ busy = false, description, eyebrow, icon, title }: StatePanelProps) {
  return (
    <section className="state-panel" aria-busy={busy} aria-live="polite">
      <div className={`state-panel__icon ${busy ? 'state-panel__icon--busy' : ''}`}>
        {busy ? <span className="spinner" aria-hidden="true" /> : icon}
      </div>
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </section>
  )
}
