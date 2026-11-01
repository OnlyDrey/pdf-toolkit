import { describe, expect, it } from 'vitest'
import { cn } from '../utils'

describe('Tailwind component overrides', () => {
  it('keeps color and width groups independent for semantic borders', () => {
    expect(cn('border border-input', 'border-2 border-primary')).toBe(
      'border-2 border-primary',
    )
  })
  it('allows navigation to override component height, radius and shadow', () => {
    const classes = cn(
      'h-10 rounded-sm shadow-xs px-3',
      'h-12 rounded-none shadow-none px-4',
    ).split(' ')
    expect(classes).toEqual(['h-12', 'rounded-none', 'shadow-none', 'px-4'])
  })
  it('preserves semantic text colors alongside font sizes and state variants', () => {
    expect(
      cn(
        'text-sm text-muted-foreground',
        'text-lg text-primary dark:text-foreground',
      ),
    ).toBe('text-lg text-primary dark:text-foreground')
  })
})
