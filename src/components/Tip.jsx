import { useState, useRef, cloneElement } from 'react'
import { createPortal } from 'react-dom'

// Attaches tooltip directly to the child element via cloneElement so
// getBoundingClientRect() reads the button's actual position, not a wrapper.
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

  // Compose with any existing mouse handlers on the child
  const child = cloneElement(children, {
    onMouseEnter: (e) => { children.props.onMouseEnter?.(e); show(e) },
    onMouseLeave: (e) => { children.props.onMouseLeave?.(e); hide() },
  })

  const below = rect && rect.top < 140
  const tipX  = rect ? Math.min(Math.max(rect.left + rect.width / 2, 120), window.innerWidth - 120) : 0
  const tipY  = rect ? (below ? rect.bottom + 8 : rect.top - 8) : 0

  return (
    <>
      {child}
      {visible && rect && createPortal(
        <div style={{
          position:      'fixed',
          left:          tipX,
          top:           tipY,
          transform:     below ? 'translateX(-50%)' : 'translateX(-50%) translateY(-100%)',
          zIndex:        99999,
          background:    'var(--surface2, #1A1A1A)',
          border:        '1px solid var(--border2, #333)',
          borderRadius:  5,
          padding:       '8px 11px',
          maxWidth:      230,
          pointerEvents: 'none',
          boxShadow:     '0 6px 28px rgba(0,0,0,.55)',
        }}>
          <div style={{ fontSize: 10, color: 'var(--text, #C0C0C8)', lineHeight: 1.65, fontFamily: 'var(--font-mono)' }}>
            {text}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
