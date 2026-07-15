import { useEffect } from 'react'

const KEYBOARD_OFFSET_THRESHOLD_PX = 80
const KEYBOARD_BASELINE_FALLBACK_PX = 40
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

function isTextInputElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false
  if (element.isContentEditable) return true
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled

  if (element instanceof HTMLInputElement) {
    if (element.readOnly || element.disabled) return false
    return !NON_TEXT_INPUT_TYPES.has((element.type || 'text').toLowerCase())
  }

  return false
}

export function useVisualViewport(): void {
  useEffect(() => {
    const root = document.getElementById('root') ?? document.documentElement
    const viewport = window.visualViewport
    let baselineHeight = viewport?.height ?? window.innerHeight

    const apply = () => {
      const height = viewport?.height ?? window.innerHeight
      const focusedTextInput = isTextInputElement(document.activeElement)

      if (!focusedTextInput) baselineHeight = height

      root.style.setProperty('--vh', `${height / 100}px`)

      const windowOffset = Math.max(0, window.innerHeight - height)
      const baselineOffset = Math.max(0, baselineHeight - height)
      const keyboardOffset = Math.max(windowOffset, baselineOffset)
      const keyboardOpen =
        keyboardOffset > KEYBOARD_OFFSET_THRESHOLD_PX ||
        (focusedTextInput && baselineOffset > KEYBOARD_BASELINE_FALLBACK_PX)

      root.style.setProperty('--keyboard-offset', `${keyboardOffset}px`)
      root.classList.toggle('keyboard-open', keyboardOpen)
    }

    apply()
    viewport?.addEventListener('resize', apply)
    viewport?.addEventListener('scroll', apply)
    window.addEventListener('resize', apply)
    document.addEventListener('focusin', apply)
    document.addEventListener('focusout', apply)

    return () => {
      viewport?.removeEventListener('resize', apply)
      viewport?.removeEventListener('scroll', apply)
      window.removeEventListener('resize', apply)
      document.removeEventListener('focusin', apply)
      document.removeEventListener('focusout', apply)
      root.classList.remove('keyboard-open')
      root.style.setProperty('--keyboard-offset', '0px')
    }
  }, [])
}
