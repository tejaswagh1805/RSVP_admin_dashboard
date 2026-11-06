import { useState } from 'react';
import { ArrowRight, LockKeyhole, ShieldCheck, Users } from 'lucide-react';

export default function SignIn({ onSignIn, error, notice, demoMode, onRetry, retrying, databaseUnavailable }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    await onSignIn(email, password);
    setBusy(false);
  };

  return <main className="signin-screen"><section className="signin-card"><div className="signin-brand"><span className="brand-mark">R</span><span className="brand-name">RSVP <b>DXB</b></span></div><div className="signin-heading"><div className="signin-shield"><ShieldCheck size={21} /></div><span className="eyebrow">ADMIN PORTAL</span><h1>Welcome back</h1><p>Sign in with your admin account to manage RSVP DXB.</p></div><form className="signin-form" onSubmit={submit}><label className="field"><span>Email address</span><div className="signin-input"><Users size={16} /><input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></div></label><label className="field"><span>Password</span><div className="signin-input"><LockKeyhole size={16} /><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /></div></label>{error && <div className="signin-error" role="alert">{error}{databaseUnavailable && <p className="signin-db-help">The API is reachable, but its database connection is failing. Check the server terminal and API health status.</p>}{onRetry && <button type="button" className="signin-retry" onClick={onRetry} disabled={retrying}>{retrying ? 'Checking connection…' : 'Retry connection'}</button>}</div>}{notice && <div className="signin-notice" role="status">{notice}</div>}<button className="button button-primary signin-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} {!busy && <ArrowRight size={15} />}</button></form>{demoMode && <div className="demo-login-note"><strong>Local demo accounts</strong><span>tejas@rsvpdxb.local or admin@rsvpdxb.local</span><span>Password: demo1234</span></div>}<div className="signin-footer">Access is limited to the two configured RSVP DXB administrators. <a href="/register">Apply for a member account</a></div></section><div className="signin-decoration"><span>RSVP DXB</span><p>Good people.<br />Great rooms.</p><i>ADMINISTRATION</i></div></main>;
}
