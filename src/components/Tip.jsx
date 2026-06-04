import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'

// Lightweight tooltip — wraps any element, shows after 500ms hover
// Usage: <Tip text="Description here"><button>...</button></Tip>
export default function Tip({ text, children, delay = 500 }) {
  const [visible, setVisible] = useState(false)
  const [rect, setRect]       = useState(null)
  const timer                 = useRef(null)

  if (!text) return children

  const show = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { setRect(r); setVisible(true) }, delay)
  }
  const hide = () => { clearTimeout(timer.current); setVisible(false) }

  // Position: above by default, below if button is near top of screen
  const below = rect && rect.top < 120
  const tipX  = rect ? Math.min(Math.max(rect.left + rect.width / 2, 120), window.innerWidth - 120) : 0
  const tipY  = rect ? (below ? rect.bottom + 8 : rect.top - 8) : 0

  return (
    <>
      <div style={{ display: 'contents' }} onMouseEnter={show} onMouseLeave={hide}>
        {children}
      </div>
      {visible && rect && createPortal(
        <div style={{
          position:  'fixed',
          left:      tipX,
          top:       tipY,
          transform: below ? 'translateX(-50%)' : 'translateX(-50%) translateY(-100%)',
          zIndex:    99999,
          background:    '#111',
          border:        '1px solid #2E2E2E',
          borderRadius:  5,
          padding:       '8px 11px',
          maxWidth:      230,
          pointerEvents: 'none',
          boxShadow:     '0 6px 28px rgba(0,0,0,.65)',
        }}>
          <div style={{ fontSize: 10, color: '#C0C0C8', lineHeight: 1.65, fontFamily: 'var(--font-mono)' }}>
            {text}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
