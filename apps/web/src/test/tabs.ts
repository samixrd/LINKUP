import { act } from 'react'

/** Clicks a MindPage section tab (Chat / Matches / Negotiations / Go Open). */
export function clickTab(label: string): void {
  const buttons = Array.from(document.querySelectorAll('.mind-tab'))
  const btn = buttons.find((b) => b.textContent?.trim() === label)
  if (!btn) {
    throw new Error(`mind tab "${label}" not found (found: ${buttons.map((b) => b.textContent?.trim()).join(', ')})`)
  }
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

/** Renders /mind then switches to a section tab, wrapped in act. */
export async function openSection(label: string): Promise<void> {
  await act(async () => {
    clickTab(label)
  })
}
