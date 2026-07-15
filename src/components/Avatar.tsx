import { useState } from 'react'

type AvatarProps = {
  name: string
  size?: 'medium' | 'large'
  src?: string | undefined
}

export function Avatar({ name, size = 'medium', src }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'C'

  return (
    <span className={`avatar avatar--${size}`} aria-hidden="true">
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        <span>{initials}</span>
      )}
    </span>
  )
}
