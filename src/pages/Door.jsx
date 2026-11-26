import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Check, Clock3, Plus, ScanLine, Search, X } from 'lucide-react';
import { api } from '../api.js';
import { EmptyState } from '../components/UI.jsx';
import { dateLabel } from '../lib/constants.js';

export default function Door({ guests, events, act }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [party, setParty] = useState(1);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const scanRef = useRef(null);
  const scanningRef = useRef(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  useEffect(() => {
    let active = true;
    const sync = () => api.list("door/guests").then((items) => {
      if (!active || !Array.isArray(items)) return;
      window.dispatchEvent(new CustomEvent("door:refresh", { detail: items }));
      setLastSyncedAt(new Date());
    }).catch(() => {});
    sync();
    const timer = window.setInterval(sync, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const preferredEvent = events.find((item) => item.id === 'marina-sunset-session') || events.find((item) => item.status === 'published');
  const event = events.find((item) => item.id === selectedEventId) || preferredEvent;
  const eventGuests = guests.filter((guest) => !event || guest.eventId === event.id);
  const expected = eventGuests.filter((guest) => !guest.isInvitation || guest.status === 'accepted').reduce((n, guest) => n + Number(guest.plusOnes || 0) + 1, 0);
  const checkedIn = eventGuests.filter((guest) => guest.checkedInAt).reduce((n, guest) => n + Number(guest.plusOnes || 0) + 1, 0);
  const scan = async (value) => {
    if (!value.trim()) return;
    try {
      const isGuestPass = /(?:^|\/)rsvp\//.test(value.trim()) || /^[A-Za-z0-9_-]{32,100}$/.test(value.trim());
      let response;
      let checkedInInvitation = null;
      if (isGuestPass) {
        try {
          const guest = await api.scanGuestPass(value, event?.id);
          checkedInInvitation = guest;
          response = { tone: 'green', title: `Welcome ${guest.guestName.split(' ')[0]}`, detail: `Guest invitation · party of ${Number(guest.plusOnes || 0) + 1}` };
        } catch (cause) {
          if (cause.status !== 404) throw cause;
          response = await api.scan(value, event?.id);
        }
      } else response = await api.scan(value, event?.id);
      setResult(response);
      setCode('');
      if (response.tone === 'green') {
        const scannedCode = value.trim().toUpperCase();
        const checkedInAt = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const updatedGuests = guests.map((guest) => guest.isInvitation && checkedInInvitation?.id === guest.id ? { ...guest, checkedInAt: checkedInInvitation.checkedInAt || checkedInAt } : guest.code?.toUpperCase() === scannedCode ? { ...guest, checkedInAt } : guest);
        window.dispatchEvent(new CustomEvent('door:refresh', { detail: updatedGuests }));
      }
    } catch (err) {
      setResult({ tone: 'red', title: 'Scan failed', detail: err.message });
    }
  };
  scanRef.current = scan;

  useEffect(() => {
    if (!cameraActive) return undefined;
    let mounted = true;
    scanningRef.current = false;
    setCameraError('');
    const scanner = new Html5Qrcode('ticket-qr-reader');
    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      (decodedText) => {
        if (!mounted || scanningRef.current) return;
        scanningRef.current = true;
        setCameraActive(false);
        scanRef.current(decodedText);
      },
      () => {},
    ).catch((error) => {
      if (!mounted) return;
      setCameraError(error?.message || 'Camera could not start. Check browser camera permission or enter the ticket code below.');
      setCameraActive(false);
    });
    return () => {
      mounted = false;
      if (scanner.isScanning) scanner.stop().catch(() => {});
    };
  }, [cameraActive]);

  const filtered = eventGuests.filter((guest) => guest.name.toLowerCase().includes(query.toLowerCase()));
  const walkIn = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    await act(() => api.walkIn({ name, plusOnes: Number(party) || 1, eventId: event?.id }), 'Walk-in added for admin review');
    setName('');
    setParty(1);
  };

  return <>
    <div className="door-event-banner">
      <div className="door-event-icon"><ScanLine size={20} /></div>
      <div className="door-event-copy"><span className="eyebrow">ACTIVE EVENT</span><h2>{event?.title || 'Select an event'}</h2><p>{event ? `${event.venue} · ${dateLabel(event.date)} · Door staff mode` : 'Create and publish an event to start check-in.'}</p></div>
      <label className="door-event-select"><span>Event</span><select value={event?.id || ''} onChange={(e) => setSelectedEventId(e.target.value)}><option value="" disabled>Select event</option>{events.filter((item) => item.status === 'published').map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <div className="door-live-state"><span className="live-pill"><i /> Door is live</span><span><Clock3 size={14} /> Synced {lastSyncedAt ? lastSyncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "when guest list is current"}</span></div>
    </div>
    <div className="door-stats"><div><span>Inside</span><strong>{checkedIn}</strong><small>guests checked in</small></div><div><span>Expected</span><strong>{expected}</strong><small>including plus-ones</small></div><div><span>Remaining</span><strong>{Math.max(expected - checkedIn, 0)}</strong><small>not yet arrived</small></div><div className="door-stat-progress"><span>Guest arrivals</span><strong>{expected ? `${Math.round(checkedIn / expected * 100)}%` : '0%'}</strong><div className="progress-track"><i style={{ width: `${expected ? Math.min(checkedIn / expected * 100, 100) : 0}%` }} /></div></div></div>
    <div className="door-grid">
      <section className="panel scan-panel">
        <div className="door-section-heading"><div><h2>Scan guest pass</h2><p>Scan a ticket QR code or enter its code manually.</p></div><span className="camera-tag"><span /> {cameraActive ? 'Camera scanning' : 'Camera ready'}</span></div>
        <div id="ticket-qr-reader" className="camera-preview" />
        <div className="camera-actions"><button className="small-action" type="button" disabled={cameraActive || !event} onClick={() => setCameraActive(true)}>{cameraActive ? 'Point at QR code…' : 'Start camera scanner'}</button>{cameraError && <span className="camera-error">{cameraError}</span>}</div>
        <form className="scan-form" onSubmit={(e) => { e.preventDefault(); scan(code); }}><input autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter ticket code or scanned value" /><button className="button button-primary"><ScanLine size={15} /> Check in</button></form>
        {result && <div className={`scan-result result-${result.tone}`}><div className="result-icon">{result.tone === 'green' ? <Check size={19} /> : <X size={19} />}</div><div><strong>{result.title}</strong><span>{result.detail}</span></div></div>}
        <div className="demo-codes"><span>Try a guest code</span>{guests.slice(0, 3).map((guest) => <button key={guest.id} onClick={() => scan(guest.code)}>{guest.code?.slice(0, 12)}</button>)}</div>
      </section>
      <div className="door-side">
        <section className="panel guest-search-panel"><div className="door-section-heading"><div><h2>Guest list</h2><p>Find a guest by name.</p></div><span className="count-pill">{filtered.length}</span></div><label className="search-box guest-search"><Search size={15} /><input placeholder="Search guest list" value={query} onChange={(e) => setQuery(e.target.value)} /></label><div className="guest-list">{filtered.map((guest) => <div className="guest-row" key={guest.id}><div className="avatar avatar-soft">{guest.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</div><div className="guest-copy"><strong>{guest.name}</strong><span>{guest.track} · party of {Number(guest.plusOnes || 0) + 1}</span></div>{guest.checkedInAt ? <span className="checked-in"><Check size={13} /> {guest.checkedInAt}</span> : <button className="small-action" onClick={() => scan(guest.code)}>Check in</button>}</div>)}{filtered.length === 0 && <EmptyState title="No guest found" detail="Try searching another name." />}</div></section>
        <section className="panel walkin-panel"><div className="door-section-heading"><div><h2>Walk-in guest</h2><p>Add someone not on the guest list.</p></div><span className="review-pill">Admin review</span></div><form className="walkin-form" onSubmit={walkIn}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Guest full name" required /><div><label>Party size</label><input type="number" min="1" value={party} onChange={(e) => setParty(e.target.value)} /></div><button className="button button-secondary"><Plus size={15} /> Add walk-in</button></form></section>
      </div>
    </div>
  </>;
}
