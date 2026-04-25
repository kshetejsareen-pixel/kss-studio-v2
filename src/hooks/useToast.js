import { useState, useCallback, useRef } from 'react'

export function useToast() {
  const [toast, setToast] = useState({ msg: '', show: false })
  const timer = useRef(null)

  const showToast = useCallback((msg, dur = 2800) => {
    if (timer.current) clearTimeout(timer.current)
    setToast({ msg, show: true })
    timer.current = setTimeout(() => setToast(t => ({ ...t, show: false })), dur)
  }, [])

  return { toast, showToast }
}
