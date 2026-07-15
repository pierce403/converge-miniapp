import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost'
}

export function Button({
  busy = false,
  children,
  className = '',
  disabled,
  type = 'button',
  variant = 'primary',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`button button--${variant} ${className}`.trim()}
      disabled={disabled || busy}
      type={type}
      {...props}
    >
      {busy ? <LoaderCircle className="button__spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  )
}
