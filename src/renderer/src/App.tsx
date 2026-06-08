import { useEffect, useState } from 'react'
import Header from './components/Header'
import LeftPanel from './components/LeftPanel'
import RightPanel from './components/RightPanel'
import SettingsModal from './components/SettingsModal'
import { usePlanetStore } from './globalConfig'

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const setProgress = usePlanetStore((s) => s.setProgress)
  const setResults = usePlanetStore((s) => s.setResults)

  useEffect(() => {
    const saved = localStorage.getItem('theme') || 'dark'
    document.documentElement.setAttribute('data-theme', saved)
  }, [])

  useEffect(() => {
    window.planet.onProgress((status) => {
      setProgress(status as any)
      if ((status as any).finished) {
        window.planet.getStatus().then((s: any) => {
          if (s.outputDir) setResults(s)
        })
      }
    })
  }, [])

  return (
    <div className="flex flex-col h-screen bg-base-200">
      <Header onSettings={() => setSettingsOpen(true)} />
      <div className="flex flex-1 overflow-hidden">
        <LeftPanel />
        <RightPanel />
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
