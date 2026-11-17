import { Sparkles } from 'lucide-react';
import { api } from '../api.js';
import { EmptyState, PageIntro } from '../components/UI.jsx';
export default function Wall({ rows = [], events = [], act }) {
  const todayDubai = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const upcomingEvents = events
    .filter((event) => event.status === 'published' && event.date && event.date >= todayDubai)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return <>
    <PageIntro title="Review brand posts" detail="Moderate submitted brand posts. Upcoming published events already appear on the customer Events Wall." action={<span className="credit-rule"><Sparkles size={15} /> Posts use 1 credit · 24h boost uses 3</span>} />
    <section className="wall-section">
      <div className="wall-section-heading"><h2>Brand posts for review</h2><span>{rows.length}</span></div>
      <div className="wall-list">{rows.map((post) => <article className={`panel wall-card ${post.boosted ? 'wall-boosted' : ''}`} key={post.id}><div className="brand-avatar">{post.brand.split(' ').map((part) => part[0]).slice(0, 2).join('')}</div><div className="wall-main"><div className="wall-meta"><strong>{post.brand}</strong><span className="type-pill">{post.type}</span><span className={`status-tag status-${post.status}`}>{post.status}</span>{post.boosted && <span className="rank-tag rank-gold">BOOSTED</span>}<span className="muted-text">{post.posted}</span></div><p>{post.body}</p></div><div className="wall-actions">{post.status === 'pending' && <button className="button button-approve" onClick={() => act(() => api.moderatePost(post.id, 'approve'), 'Post approved')}>Approve</button>}<button className="button button-secondary" onClick={() => act(() => api.moderatePost(post.id, 'boost'), post.boosted ? 'Boost removed' : 'Post boosted for 24 hours')}>{post.boosted ? 'Unboost' : 'Boost · 3'}</button><button className="button button-danger-outline" onClick={() => act(() => api.moderatePost(post.id, 'remove'), 'Post removed')}>Remove</button></div></article>)}{rows.length === 0 && <EmptyState title="No brand posts to review" detail="This queue only contains submitted brand posts. Upcoming published events are shown below and appear on the customer wall automatically." />}</div>
    </section>
    <section className="wall-section">
      <div className="wall-section-heading"><h2>Upcoming events on the customer wall</h2><span>{upcomingEvents.length}</span></div>
      <div className="wall-list">{upcomingEvents.map((event) => <article className="panel wall-card wall-event-card" key={event.id}>
        {event.imageUrl ? <img className="wall-event-thumb" src={event.imageUrl} alt="" /> : <div className="brand-avatar">{String(event.brand || 'RSVP DXB').split(' ').map((part) => part[0]).slice(0, 2).join('')}</div>}
        <div className="wall-main"><div className="wall-meta"><strong>{event.title}</strong><span className="type-pill">New Event</span><span className="status-tag status-approved">Live</span></div><p>{[event.date, event.time, event.venue, event.area].filter(Boolean).join(' · ')}</p></div>
      </article>)}{upcomingEvents.length === 0 && <EmptyState title="No upcoming published events" detail="Publish an upcoming event and it will appear on the customer Events Wall." />}</div>
    </section>
  </>;
}

