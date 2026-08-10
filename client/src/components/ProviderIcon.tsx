import type { Provider } from '../types'

// Monogram badges, not the real trademarked marks — enough to eyeball which provider a row is
// without redrawing Anthropic's/OpenAI's actual logo geometry.
const BADGE: Record<Provider, { bg: string; letter: string }> = {
  anthropic: { bg: '#CC785C', letter: 'A' },
  openai: { bg: '#10A37F', letter: 'O' },
}

export function ProviderIcon({ provider, size = 14 }: { provider: Provider; size?: number }) {
  const { bg, letter } = BADGE[provider]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        color: '#fff',
        fontSize: size * 0.62,
        fontWeight: 700,
        fontFamily: 'Helvetica, Arial, sans-serif',
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {letter}
    </span>
  )
}
