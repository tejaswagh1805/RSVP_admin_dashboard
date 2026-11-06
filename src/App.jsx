import { useCallback, useEffect, useState } from 'react';
import { CheckCheck, X, ArrowUpRight } from 'lucide-react';
import { api } from './api.js';
import { TITLES } from './lib/constants.js';
import AdminSidebar from './layout/AdminSidebar.jsx';
import AdminTopbar from './layout/AdminTopbar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Applications from './pages/Applications.jsx';
import Members from './pages/Members.jsx';
import Events, { EventModal, GuestModal } from './pages/Events.jsx';
import Invitations from './pages/Invitations.jsx';
import Wall from './pages/Wall.jsx';
import Clients from './pages/Clients.jsx';
import Door from './pages/Door.jsx';
import SignIn from './pages/SignIn.jsx';
import Register from './pages/Register.jsx';
import WebsiteMedia from './pages/WebsiteMedia.jsx';
import PeopleProfiles from './pages/PeopleProfiles.jsx';
import Venues from './pages/Venues.jsx';
import Newsletter from './pages/Newsletter.jsx';

export default function App() {
  const [page, setPage] = useState(() => location.hash.replace('#/', '') || 'dashboard');
  const [data, setData] = useState({ applications: [], members: [], events: [], siteMedia: [], peopleProfiles: [], venues: [], wall: [], clients: [], guests: [], dashboard: {} });
  const [admin, setAdmin] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [dbRetrying, setDbRetrying] = useState(false);
  const [dbUnavailable, setDbUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);

  const refresh = useCallback(async () => {
    setError('');
    try {
      // Keep older deployed API instances usable while the people-profiles
      // route is being rolled out. The new page can show an empty state until
      // the matching server version is deployed.
      const peopleProfilesRequest = api.list('people-profiles').catch((err) => {
        if (err.status === 404) return [];
        throw err;
      });
      const venuesRequest = api.list('venues').catch((err) => {
        if (err.status === 404) return [];
        throw err;
      });
      const [dashboard, applications, members, fetchedEvents, siteMedia, peopleProfiles, venues, wall, clients, guests] = await Promise.all([
        api.dashboard(), api.list('applications'), api.list('members'), api.list('events'), api.list('site-media'), peopleProfilesRequest, venuesRequest, api.list('wall'), api.list('clients'), api.list('door/guests'),
      ]);
      setData({ dashboard, applications, members, events: fetchedEvents, siteMedia, peopleProfiles, venues, wall, clients, guests });
    } catch (err) { if (err.status === 401) { setAdmin(null); setAuthError(err.message); } else setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    api.me().then(async ({ admin: currentAdmin, demoMode: isDemoMode }) => {
      if (!active) return;
      setAdmin(currentAdmin);
      setDemoMode(isDemoMode);
      setDbUnavailable(false);
      if (currentAdmin) await refresh();
      else setLoading(false);
    }).catch((err) => {
      if (!active) return;
      setAuthError(err.message);
      setDbRetrying(err.status === 503 || !err.status);
      setDbUnavailable(err.status === 503 || !err.status);
      setLoading(false);
    }).finally(() => { if (active) setAuthLoading(false); });
    return () => { active = false; };
  }, [refresh]);
  useEffect(() => {
    const onHash = () => setPage(location.hash.replace('#/', '') || 'dashboard');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const onDoorRefresh = (event) => setData((previous) => ({ ...previous, guests: event.detail }));
    window.addEventListener('door:refresh', onDoorRefresh);
    return () => window.removeEventListener('door:refresh', onDoorRefresh);
  }, []);
  useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(''), 3000); return () => clearTimeout(timer); }, [toast]);

  const navigate = (to) => { location.hash = `/${to}`; setPage(to); setMobileNav(false); setSearch(''); };
  const act = async (fn, success) => {
    try {
      const result = await fn();
      await refresh();
      setToast(typeof success === 'function' ? success(result) : success);
      return { ok: true, result };
    } catch (error) {
      setToast(error.message || 'The action could not be completed.');
      return { ok: false, error };
    }
  };
  const signIn = async (email, password) => {
    setAuthError('');
    try {
      const result = await api.login(email, password);
      setAdmin(result.admin);
      setDemoMode(result.demoMode);
      setAuthNotice('');
      setError('');
      setLoading(true);
      await refresh();
    } catch (err) { setAuthError(err.message); }
  };
  const signOut = async (switching = false) => {
    try { await api.logout(); } catch (err) { setToast(`Could not sign out: ${err.message}`); return; }
    setAdmin(null);
    setData({ applications: [], members: [], events: [], siteMedia: [], peopleProfiles: [], venues: [], wall: [], clients: [], guests: [], dashboard: {} });
    setAuthNotice(switching ? 'Signed out. Sign in with the other admin account.' : 'You have signed out.');
    setAuthError('');
    setLoading(false);
    setPage('dashboard');
    location.hash = '';
  };
  const pending = data.applications.filter((item) => item.status === 'pending').length;
  const pages = {
    dashboard: <Dashboard data={data} navigate={navigate} />,
    applications: <Applications rows={data.applications} query={search} setQuery={setSearch} act={act} />,
    members: <Members rows={data.members} query={search} setQuery={setSearch} act={act} />,
      events: <Events rows={data.events} guests={data.guests} act={act} openModal={setModal} />,
    websiteMedia: <WebsiteMedia rows={data.siteMedia} act={act} />,
    peopleProfiles: <PeopleProfiles rows={data.peopleProfiles} act={act} />,
    venues: <Venues rows={data.venues} act={act} />,
    newsletter: <Newsletter />,
    invitations: <Invitations events={data.events} />,
    wall: <Wall rows={data.wall} act={act} />,
    clients: <Clients rows={data.clients} act={act} />,
      door: <Door guests={data.guests} events={data.events} act={act} />,
  };

  if (location.pathname.replace(/\/$/, '') === '/register') return <Register />;
  if (authLoading) return <main className="signin-screen"><div className="loading-state"><span className="spinner" /> Checking admin session…</div></main>;
  if (!admin) return <SignIn onSignIn={signIn} error={authError} notice={authNotice} demoMode={demoMode} retrying={dbRetrying} databaseUnavailable={dbUnavailable} onRetry={async () => { if (dbRetrying) return; setDbRetrying(true); try { const { admin: currentAdmin, demoMode: isDemoMode } = await api.me(); setAdmin(currentAdmin); setDemoMode(isDemoMode); setDbUnavailable(false); setAuthError(''); if (currentAdmin) { setLoading(true); await refresh(); } else setAuthNotice('Database connection is healthy. Sign in with your administrator account.'); } catch (err) { setAuthError(err.message); setDbUnavailable(err.status === 503 || !err.status); } finally { setDbRetrying(false); } }} />;

  return <div className="app-shell">
    <AdminSidebar page={page} pendingCount={pending} open={mobileNav} onClose={() => setMobileNav(false)} navigate={navigate} admin={admin} onSignOut={() => signOut(false)} onSwitchAccount={() => signOut(true)} />
    {mobileNav && <button className="scrim" aria-label="Close menu" onClick={() => setMobileNav(false)} />}
    <main className="main-column">
      <AdminTopbar page={page} search={search} setSearch={setSearch} onOpenMenu={() => setMobileNav(true)} onNotify={() => setToast(pending ? `${pending} member applications are waiting for review.` : 'You are all caught up.')} admin={admin} onSignOut={() => signOut(false)} onSwitchAccount={() => signOut(true)} />
      <div className="content-wrap">
        <div className="page-heading"><div><div className="eyebrow">RSVP DXB <span>/</span> ADMIN PORTAL</div><h1>{TITLES[page] || 'Dashboard'}</h1></div><div className="heading-actions">{page === 'dashboard' && <span className="live-pill"><i /> Live overview</span>}{page === 'events' && <button className="button button-primary" onClick={() => setModal({ type: 'create-event' })}><span>＋</span> Create event <ArrowUpRight size={15} /></button>}</div></div>
        {error && <div className="alert-banner"><span>{error}</span><button onClick={refresh}>Retry</button></div>}
        {loading ? <div className="loading-state"><span className="spinner" /> Loading workspace…</div> : pages[page] || pages.dashboard}
      </div>
    </main>
    {modal?.type === 'create-event' && <EventModal close={() => setModal(null)} act={act} />}
    {modal?.type === 'edit-event' && <EventModal event={modal.event} close={() => setModal(null)} act={act} />}
    {modal?.type === 'guest-list' && <GuestModal event={modal.event} guests={data.guests} close={() => setModal(null)} />}
    {toast && <div className="toast"><CheckCheck size={16} />{toast}<button onClick={() => setToast('')}><X size={14} /></button></div>}
  </div>;
}
