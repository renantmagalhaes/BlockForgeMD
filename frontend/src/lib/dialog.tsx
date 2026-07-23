import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'

type DialogRequest =
  | { kind: 'alert'; title: string; message: string; resolve: () => void }
  | { kind: 'confirm'; title: string; message: string; confirmLabel: string; danger: boolean; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; title: string; message: string; defaultValue: string; placeholder: string; confirmLabel: string; allowEmpty: boolean; resolve: (value: string | null) => void }

let dispatch: ((req: DialogRequest | null) => void) | null = null

/** Mount once near the app root — every alert/confirm/prompt call below renders through this host. */
export function DialogHost() {
  const [request, setRequest] = useState<DialogRequest | null>(null)
  const [inputValue, setInputValue] = useState('')

  useEffect(() => {
    dispatch = (req) => {
      setRequest(req)
      if (req?.kind === 'prompt') setInputValue(req.defaultValue)
    }
    return () => { dispatch = null }
  }, [])

  if (!request) return null

  const close = () => setRequest(null)

  const submitPrompt = () => {
    if (request.kind !== 'prompt') return
    if (!request.allowEmpty && !inputValue.trim()) return
    request.resolve(inputValue)
    close()
  }
  const cancelPrompt = () => {
    if (request.kind !== 'prompt') return
    request.resolve(null)
    close()
  }
  const submitConfirm = (ok: boolean) => {
    if (request.kind !== 'confirm') return
    request.resolve(ok)
    close()
  }
  const dismissAlert = () => {
    if (request.kind !== 'alert') return
    request.resolve()
    close()
  }
  const dismissViaBackdrop = () => {
    if (request.kind === 'prompt') cancelPrompt()
    else if (request.kind === 'confirm') submitConfirm(false)
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        data-editor-popover="true"
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[999999] flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onMouseDown={(e) => { if (e.target === e.currentTarget) dismissViaBackdrop() }}
      >
        <motion.div
          className="bf-popover-card bg-[#161b22] border border-slate-800 rounded-2xl max-w-sm w-full shadow-2xl p-6"
          initial={{ scale: 0.95, y: 10 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 10 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        >
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold text-base text-slate-100">{request.title}</h3>
            {request.kind !== 'alert' && (
              <button
                onClick={request.kind === 'prompt' ? cancelPrompt : () => submitConfirm(false)}
                className="text-slate-500 hover:text-slate-300 transition cursor-pointer"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <p className="text-sm text-slate-400 whitespace-pre-line mb-4">{request.message}</p>

          {request.kind === 'prompt' && (
            <input
              autoFocus
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') submitPrompt()
                if (e.key === 'Escape') cancelPrompt()
              }}
              placeholder={request.placeholder}
              className="w-full bg-slate-950 border border-slate-700 focus:border-violet-500 rounded-lg px-3 py-2 text-sm text-slate-100 outline-none transition"
            />
          )}

          <div className="flex gap-2 justify-end mt-5">
            {request.kind === 'alert' && (
              <button
                autoFocus
                type="button"
                onClick={dismissAlert}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-semibold shadow transition cursor-pointer"
              >OK</button>
            )}
            {request.kind === 'confirm' && (
              <>
                <button
                  type="button"
                  onClick={() => submitConfirm(false)}
                  className="px-4 py-2 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg text-xs font-semibold transition cursor-pointer"
                >Cancel</button>
                <button
                  autoFocus
                  type="button"
                  onClick={() => submitConfirm(true)}
                  className={`px-4 py-2 text-white rounded-lg text-xs font-semibold shadow transition cursor-pointer ${request.danger ? 'bg-red-600 hover:bg-red-500' : 'bg-violet-600 hover:bg-violet-500'}`}
                >{request.confirmLabel}</button>
              </>
            )}
            {request.kind === 'prompt' && (
              <>
                <button
                  type="button"
                  onClick={cancelPrompt}
                  className="px-4 py-2 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg text-xs font-semibold transition cursor-pointer"
                >Cancel</button>
                <button
                  type="button"
                  disabled={!request.allowEmpty && !inputValue.trim()}
                  onClick={submitPrompt}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold shadow transition cursor-pointer"
                >{request.confirmLabel}</button>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}

/** Drop-in replacement for window.alert — styled to match the rest of the app. */
export function alertDialog(message: string, title = 'Notice'): Promise<void> {
  return new Promise(resolve => dispatch?.({ kind: 'alert', title, message, resolve }))
}

/** Drop-in replacement for window.confirm — styled to match the rest of the app. */
export function confirmDialog(
  message: string,
  opts: { title?: string; confirmLabel?: string; danger?: boolean } = {}
): Promise<boolean> {
  return new Promise(resolve => dispatch?.({
    kind: 'confirm',
    title: opts.title ?? 'Please confirm',
    message,
    confirmLabel: opts.confirmLabel ?? 'Confirm',
    danger: opts.danger ?? false,
    resolve,
  }))
}

/** Drop-in replacement for window.prompt — styled to match the rest of the app. */
export function promptDialog(
  message: string,
  defaultValue = '',
  opts: { title?: string; placeholder?: string; confirmLabel?: string; allowEmpty?: boolean } = {}
): Promise<string | null> {
  return new Promise(resolve => dispatch?.({
    kind: 'prompt',
    title: opts.title ?? 'Enter a value',
    message,
    defaultValue,
    placeholder: opts.placeholder ?? '',
    confirmLabel: opts.confirmLabel ?? 'OK',
    allowEmpty: opts.allowEmpty ?? false,
    resolve,
  }))
}
