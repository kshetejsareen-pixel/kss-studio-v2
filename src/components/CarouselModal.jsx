import { useState, useEffect, useCallback } from 'react'

export default function CarouselModal({ post, images, postNum, onClose }) {
  const [current, setCurrent] = useState(0)

  const slides = post?.slides || []
  const total  = slides.length

  const prev = useCallback(() => setCurrent(c => (c - 1 + total) % total), [total])
  const next = useCallback(() => setCurrent(c => (c + 1) % total), [total])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowLeft')  prev()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'Escape')     onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [prev, next, onClose])

  const getImg = (idx) => {
    if (!idx || idx < 1 || idx > images.length) return null
    return images[idx - 1]
  }

  const currentImg = getImg(slides[current])
  const transforms = post?.slideTransforms || {}
  const t = transforms[current] || { panX: 50, panY: 50 }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(8px)',
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, maxWidth: '90vw' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', maxWidth: 420 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--text)', flex: 1 }}>
            Post #{postNum}
            <span style={{ fontSize: 11, color: 'var(--mute)', fontFamily: 'var(--font-mono)', marginLeft: 8 }}>
              {post?.type} · {total} slide{total !== 1 ? 's' : ''}
            </span>
          </div>
          <button onClick={onClose}
            style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: '50%', width: 32, height: 32, color: 'var(--mute)', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ✕
          </button>
        </div>

        {/* Main image */}
        <div style={{
          position: 'relative',
          width: 'min(420px, 80vw)',
          aspectRatio: '4/5',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--surface)',
          boxShadow: '0 24px 64px rgba(0,0,0,.6)',
        }}>
          {currentImg ? (
            <img
              src={currentImg.dataUrl}
              alt=""
              style={{
                width: '100%', height: '100%',
                objectFit: 'cover',
                objectPosition: `${t.panX}% ${t.panY}%`,
                display: 'block',
                transform: post?.rotate || post?.flipH || post?.flipV
                  ? [
                      post.rotate ? `rotate(${post.rotate}deg)` : '',
                      post.flipH ? 'scaleX(-1)' : '',
                      post.flipV ? 'scaleY(-1)' : '',
                    ].filter(Boolean).join(' ')
                  : 'none',
              }}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--mute)', fontSize: 11 }}>
              Image not found
            </div>
          )}

          {/* Slide counter */}
          {total > 1 && (
            <div style={{
              position: 'absolute', top: 12, right: 12,
              background: 'rgba(0,0,0,.65)',
              color: '#fff', fontSize: 10,
              padding: '3px 8px', borderRadius: 12,
              fontFamily: 'var(--font-mono)',
            }}>
              {current + 1} / {total}
            </div>
          )}

          {/* Nav arrows */}
          {total > 1 && (
            <>
              <button onClick={prev}
                style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,.6)', border: '1px solid rgba(255,255,255,.15)', borderRadius: '50%', width: 36, height: 36, color: '#fff', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                ‹
              </button>
              <button onClick={next}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,.6)', border: '1px solid rgba(255,255,255,.15)', borderRadius: '50%', width: 36, height: 36, color: '#fff', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                ›
              </button>
            </>
          )}
        </div>

        {/* Dot indicators */}
        {total > 1 && (
          <div style={{ display: 'flex', gap: 6 }}>
            {slides.map((_, i) => (
              <button key={i} onClick={() => setCurrent(i)}
                style={{ width: i === current ? 20 : 6, height: 6, borderRadius: 3, background: i === current ? 'var(--silver)' : 'rgba(255,255,255,.2)', border: 'none', cursor: 'pointer', transition: 'all .2s', padding: 0 }} />
            ))}
          </div>
        )}

        {/* Thumbnail strip */}
        {total > 1 && (
          <div style={{ display: 'flex', gap: 6, maxWidth: 420, overflow: 'auto', padding: '4px 0' }}>
            {slides.map((idx, i) => {
              const img = getImg(idx)
              const st = transforms[i] || { panX: 50, panY: 50 }
              return (
                <div key={i} onClick={() => setCurrent(i)}
                  style={{
                    width: 52, height: 52, flexShrink: 0,
                    borderRadius: 4, overflow: 'hidden',
                    border: `2px solid ${i === current ? 'var(--silver)' : 'transparent'}`,
                    cursor: 'pointer', transition: 'border-color .15s',
                    background: 'var(--surface)',
                  }}>
                  {img && (
                    <img src={img.dataUrl} alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${st.panX}% ${st.panY}%` }} />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Caption preview */}
        {post?.caption && (
          <div style={{
            maxWidth: 420, width: '100%',
            background: 'rgba(255,255,255,.04)',
            border: '1px solid var(--border)',
            borderRadius: 8, padding: '12px 16px',
          }}>
            <div style={{ fontSize: 9, color: 'var(--silver)', fontFamily: 'var(--font-mono)', marginBottom: 6, letterSpacing: '.1em', textTransform: 'uppercase' }}>Caption</div>
            <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{post.caption}</div>
            {post.firstComment && (
              <div style={{ marginTop: 8, fontSize: 10, color: 'var(--silver-dim)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>{post.firstComment}</div>
            )}
          </div>
        )}

        {/* Keyboard hint */}
        <div style={{ fontSize: 9, color: 'var(--mute2)', fontFamily: 'var(--font-mono)' }}>
          ← → to navigate · Esc to close
        </div>
      </div>
    </div>
  )
}
