import { EmptyState, PageIntro } from '../components/UI.jsx';

export default function Wall({ events = [] }) {
  const todayDubai = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const upcomingEvents = events
    .filter((event) => event.status === 'published' && event.date && event.date >= todayDubai)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return <>
    <PageIntro title="Customer wall preview" detail="Upcoming published events appear automatically on the customer Events Wall." />
    <section className="wall-section">
      <div className="wall-section-heading"><h2>Upcoming events</h2><span>{upcomingEvents.length}</span></div>
      <div className="wall-list">{upcomingEvents.map((event) => <article className="panel wall-card wall-event-card" key={event.id}>
        {event.imageUrl ? <img className="wall-event-thumb" src={event.imageUrl} alt="" /> : <div className="brand-avatar">{String(event.brand || 'RSVP DXB').split(' ').map((part) => part[0]).slice(0, 2).join('')}</div>}
        <div className="wall-main"><div className="wall-meta"><strong>{event.title}</strong><span className="type-pill">New Event</span><span className="status-tag status-approved">Live</span></div><p>{[event.date, event.time, event.venue, event.area].filter(Boolean).join(' · ')}</p></div>
      </article>)}{upcomingEvents.length === 0 && <EmptyState title="No upcoming published events" detail="Publish an upcoming event and it will appear on the customer Events Wall." />}</div>
    </section>
  </>;
}
