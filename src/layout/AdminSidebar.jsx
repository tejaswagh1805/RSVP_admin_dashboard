import { CalendarDays, ChevronDown, CircleHelp, ExternalLink, FileText, Home, Image, Radio, ScanLine, TicketCheck, Users, WalletCards, X, Sparkles, MapPin, Mail, Inbox } from 'lucide-react';
import AccountMenu from '../components/AccountMenu.jsx';

const SECTIONS = [
  { title: 'OVERVIEW', links: [['Dashboard', 'dashboard', Home]] },
  { title: 'PEOPLE', links: [['Applications', 'applications', FileText], ['Members', 'members', Users], ['Website enquiries', 'enquiries', Inbox]] },
  { title: 'AUDIENCE', links: [['Newsletter', 'newsletter', Mail]] },
  { title: 'PROGRAMME', links: [['Events', 'events', CalendarDays], ['Venues', 'venues', MapPin], ['Website Media', 'websiteMedia', Image], ['Artists & Influencers', 'peopleProfiles', Sparkles], ['Invitations', 'invitations', TicketCheck], ['Events Wall', 'wall', Radio]] },
  { title: 'BUSINESS', links: [['Clients & credits', 'clients', WalletCards]] },
  { title: 'OPERATIONS', links: [['Door app', 'door', ScanLine]] },
];

export default function AdminSidebar({ page, pendingCount, open, onClose, navigate, admin, onSignOut, onSwitchAccount }) {
  return <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
    <div className="brand-lockup"><div className="brand-mark">R</div><div><div className="brand-name">RSVP <span>DXB</span></div><div className="brand-caption">PRIVATE EVENTS PLATFORM</div></div><button className="icon-button sidebar-close" onClick={onClose} aria-label="Close menu"><X size={17} /></button></div>
    <div className="workspace"><span className="workspace-avatar">T</span><span className="workspace-copy"><strong>Tickbox UAE</strong><span>Admin workspace</span></span><ChevronDown size={15} /></div>
    <nav className="side-nav">{SECTIONS.map((section) => <div className="nav-section" key={section.title}><div className="nav-label">{section.title}</div>{section.links.map(([label, key, Icon]) => <button className={`nav-item ${page === key ? 'active' : ''}`} key={key} onClick={() => navigate(key)}><Icon size={17} strokeWidth={1.7} /><span>{label}</span>{key === 'applications' && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}</button>)}</div>)}</nav>
    <div className="sidebar-bottom"><a className="help-card" href="mailto:hello@rsvpdxb.com"><span className="help-icon"><CircleHelp size={16} /></span><span><strong>Need a hand?</strong><span>Contact platform support</span></span><ExternalLink size={14} /></a><AccountMenu variant="sidebar" admin={admin} onSignOut={onSignOut} onSwitchAccount={onSwitchAccount} /></div>
  </aside>;
}
