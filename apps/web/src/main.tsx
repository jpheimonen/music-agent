import React from 'react';
import { createRoot } from 'react-dom/client';
import { capabilities, type Capabilities } from '@music/contracts';

function App() {
  const [state, setState] = React.useState<Capabilities | null>(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => { fetch('/api/v1/capabilities').then(async response => { if (!response.ok) throw new Error('Backend unavailable'); setState(capabilities.parse(await response.json())); }).catch(() => setError('Backend unavailable. Start the local server to continue.')); }, []);
  return <main style={{fontFamily:'system-ui',maxWidth:700,margin:'10vh auto',padding:24}}><h1>Music</h1><p>Local listening setup</p>{error && <p role="alert">{error}</p>}{state ? <dl><dt>Local library</dt><dd>{state.library.state}</dd><dt>Codex DJ</dt><dd>{state.codex.state}</dd><dt>YouTube discovery</dt><dd>{state.youtubeDiscovery.state}</dd><dt>Radio</dt><dd>{Object.entries(state.stations).map(([name, station]) => `${name}: ${station.state}`).join(' · ')}</dd></dl> : !error && <p>Checking local services…</p>}</main>;
}
createRoot(document.getElementById('root')!).render(<App />);
