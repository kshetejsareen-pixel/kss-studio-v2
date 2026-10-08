// The studio shell: gates (boot error, loading, passcode, second tab), the step rail and
// the current step. Steps are routed by the URL hash (#/plan, #/write?postId=…).
import { Component } from 'react'
import Icon from './components/Icon.jsx'
import { Btn, Toasts, ConfirmHost } from './components/ui.jsx'
import { StepRail, TopBar, NextBar, MobileNav, PasscodeScreen, LockOverlay, Loading } from './components/shell.jsx'
import { useStore } from './store/StoreProvider.jsx'
import { useScheduler } from './store/useScheduler.js'
import Brief from './steps/Brief.jsx'
import Library from './steps/Library.jsx'
import Plan from './steps/Plan.jsx'
import Create from './steps/Create.jsx'
import Write from './steps/Write.jsx'
import Review from './steps/Review.jsx'
import Schedule from './steps/Schedule.jsx'
import Measure from './steps/Measure.jsx'
import Promote from './steps/Promote.jsx'
import Settings from './steps/Settings.jsx'

const SCREENS = { brief: Brief, library: Library, plan: Plan, create: Create, write: Write, review: Review, schedule: Schedule, measure: Measure, promote: Promote, settings: Settings }

export default function App() {
  const store = useStore()
  useScheduler(store)
  const { ready, bootError, session, skipServer, isPrimary, route } = store

  if (bootError) {
    return (
      <div className="gate">
        <div className="gate-card">
          <Icon name="warning" size={24} />
          <h2>The studio couldn’t open</h2>
          <p>{bootError}</p>
          <p className="field-hint">Your work is still saved in this browser. Private windows and blocked site storage stop the studio from opening.</p>
          <Btn kind="primary" icon="refresh" onClick={() => window.location.reload()}>Try again</Btn>
        </div>
      </div>
    )
  }
  if (!ready || !session.checked) return <Loading />
  if (session.needsPasscode && !skipServer) return <PasscodeScreen />

  const Screen = SCREENS[route.step] || Brief
  return (
    <div className="app">
      <StepRail />
      <div className="main">
        <TopBar />
        <main className="content" id="content">
          <StepBoundary key={route.step}>
            <Screen />
          </StepBoundary>
        </main>
        <NextBar />
      </div>
      <MobileNav />
      <Toasts />
      <ConfirmHost />
      {!isPrimary && <LockOverlay />}
    </div>
  )
}

// One broken screen shouldn't take the whole studio down; the saved document is untouched.
class StepBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error(error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="empty">
        <Icon name="warning" size={26} />
        <h3>This screen hit a problem</h3>
        <p className="mute">{String(this.state.error?.message || this.state.error)}</p>
        <Btn kind="ghost" icon="refresh" onClick={() => this.setState({ error: null })}>Try again</Btn>
      </div>
    )
  }
}
