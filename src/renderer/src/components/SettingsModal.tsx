import { useEffect, useState } from 'react'

interface Props { onClose: () => void }

export default function SettingsModal({ onClose }: Props) {
  const [key, setKey] = useState('')
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')

  useEffect(() => {
    window.planet.loadKey().then(setKey)
  }, [])

  const onTest = async () => {
    setStatus('testing')
    const ok = await window.planet.validateKey(key.trim())
    setStatus(ok ? 'ok' : 'fail')
  }

  const onSave = async () => {
    await window.planet.saveKey(key.trim())
    onClose()
  }

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-md">
        <h3 className="font-bold text-lg mb-4">Settings</h3>

        <label className="label"><span className="label-text font-medium">Planet API Key</span></label>
        <input
          type="password"
          className="input input-bordered w-full"
          value={key}
          onChange={(e) => { setKey(e.target.value); setStatus('idle') }}
          placeholder="pl.ey..."
        />

        <div className="flex items-center gap-3 mt-3">
          <button className="btn btn-sm btn-outline" onClick={onTest} disabled={status === 'testing'}>
            {status === 'testing' ? <span className="loading loading-spinner loading-xs" /> : 'Test Connection'}
          </button>
          {status === 'ok' && <span className="text-success text-sm">Connected!</span>}
          {status === 'fail' && <span className="text-error text-sm">Invalid key</span>}
        </div>

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave}>Save</button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  )
}
