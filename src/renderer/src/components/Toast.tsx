import React, { createContext, useCallback, useContext, useRef, useState } from 'react'

const ToastCtx = createContext<(msg: string) => void>(() => {})

export function useToast(): (msg: string) => void {
  return useContext(ToastCtx)
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  const show = useCallback((m: string) => {
    setMsg(m)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMsg(null), 2400)
  }, [])

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </ToastCtx.Provider>
  )
}
