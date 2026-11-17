export const TRACKS = ['Media', 'Creators', 'Tastemakers', 'Private Circle'];
export const TITLES = { dashboard: 'Dashboard', applications: 'Applications', members: 'Members', events: 'Events', venues: 'Venues', websiteMedia: 'Website Media', peopleProfiles: 'Artists & Influencers', invitations: 'Invitations', wall: 'Events Wall', clients: 'Clients & credits', door: 'Door app', newsletter: 'Newsletter', enquiries: 'Website enquiries' };
export const dateLabel = (date) => date ? new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const money = (amount) => `AED ${Number(amount || 0).toLocaleString('en-US')}`;
