import React, { useState, useCallback, useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import ProcessVideos from './pages/ProcessVideos';
import VideoList from './pages/VideoList';
import VideoReview from './pages/VideoReview';
import Settings from './pages/Settings';
import Reports from './pages/Reports';
import { fetchBranding } from './api';
import { useI18n } from './i18n';

const PAGE_KEYS = [
  { key: 'dashboard', labelKey: 'menu.dashboard', icon: 'chart' },
  { key: 'process', labelKey: 'menu.process', icon: 'upload' },
  { key: 'videos', labelKey: 'menu.videos', icon: 'list' },
  { key: 'review', labelKey: 'menu.review', icon: 'review' },
  { key: 'reports', labelKey: 'menu.reports', icon: 'list' },
  { key: 'settings', labelKey: 'menu.settings', icon: 'config' },
];

const PAGE_COMPONENTS = {
  dashboard: Dashboard, process: ProcessVideos,
  videos: VideoList, review: VideoReview, reports: Reports, settings: Settings,
};

const ICONS = {
  chart: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="10" width="3" height="8" rx="1" fill="currentColor"/><rect x="7" y="6" width="3" height="12" rx="1" fill="currentColor"/><rect x="12" y="3" width="3" height="15" rx="1" fill="currentColor"/></svg>,
  upload: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3v10M10 3l-4 4M10 3l4 4M3 14v2a1 1 0 001 1h12a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  batch: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="7" height="7" rx="1" fill="currentColor" opacity="0.7"/><rect x="11" y="2" width="7" height="7" rx="1" fill="currentColor" opacity="0.5"/><rect x="2" y="11" width="7" height="7" rx="1" fill="currentColor" opacity="0.5"/><rect x="11" y="11" width="7" height="7" rx="1" fill="currentColor" opacity="0.3"/></svg>,
  list: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="3" width="16" height="3" rx="1" fill="currentColor" opacity="0.8"/><rect x="2" y="8.5" width="16" height="3" rx="1" fill="currentColor" opacity="0.6"/><rect x="2" y="14" width="16" height="3" rx="1" fill="currentColor" opacity="0.4"/></svg>,
  review: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 1l2.47 5.01L18 6.91l-4 3.9.94 5.5L10 13.76l-4.94 2.55.94-5.5-4-3.9 5.53-.8z" fill="currentColor"/></svg>,
  config: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="2"/><path d="M10 1v3M10 16v3M1 10h3M16 10h3M3.5 3.5l2.1 2.1M14.4 14.4l2.1 2.1M3.5 16.5l2.1-2.1M14.4 5.6l2.1-2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
  palette: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2"/><circle cx="7" cy="8" r="1.5" fill="currentColor"/><circle cx="13" cy="8" r="1.5" fill="currentColor"/><circle cx="10" cy="13" r="1.5" fill="currentColor"/></svg>,
};

const LANGS = [{ code: 'pt', flag: 'PT' }, { code: 'en', flag: 'EN' }, { code: 'es', flag: 'ES' }];
const DEFAULT_COLORS = { primary_color: '#2563EB', secondary_color: '#1E293B', accent_color: '#3B82F6', sidebar_color: '#0F172A' };

function App() {
  const { t, lang, setLanguage } = useI18n();
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [pageParams, setPageParams] = useState({});
  const [colors, setColors] = useState(DEFAULT_COLORS);
  const [customLogo, setCustomLogo] = useState(null);

  useEffect(() => {
    fetchBranding().then(b => {
      const c = { ...DEFAULT_COLORS };
      Object.keys(DEFAULT_COLORS).forEach(k => { if (b[k]) c[k] = b[k]; });
      setColors(c);
      if (b.logo_path) setCustomLogo(b.logo_path);
    }).catch(() => {});
  }, [currentPage]);

  const [pageKey, setPageKey] = useState(0);
  const navigate = useCallback((page, params = {}) => {
    setCurrentPage(page);
    setPageParams(params);
    if (Object.keys(params).length === 0) setPageKey(k => k + 1);
  }, []);

  const PageComponent = PAGE_COMPONENTS[currentPage] || Dashboard;

  return (
    <div className="app-layout" style={{
      '--dbxsc-primary': colors.primary_color, '--dbxsc-dark': colors.secondary_color,
      '--dbxsc-accent': colors.accent_color, '--dbxsc-sidebar': colors.sidebar_color,
    }}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            {customLogo ? <img src="/api/branding/logo" alt="Logo" className="custom-logo" /> : <DBXSCLogo />}
          </div>
          <div className="sidebar-subtitle">Databricks Scenic Crawler AI</div>
        </div>
        <nav className="sidebar-nav">
          {PAGE_KEYS.map(page => (
            <a key={page.key} href="#" className={currentPage === page.key ? 'active' : ''}
              onClick={e => { e.preventDefault(); navigate(page.key); }}>
              <span className="nav-icon">{ICONS[page.icon]}</span>
              <span>{t(page.labelKey)}</span>
            </a>
          ))}
        </nav>
        {/* Language selector */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: 6, justifyContent: 'center' }}>
          {LANGS.map(l => (
            <button key={l.code} onClick={() => setLanguage(l.code)}
              style={{
                padding: '4px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
                background: lang === l.code ? 'var(--dbxsc-primary)' : 'rgba(255,255,255,0.1)',
                color: 'white', transition: 'background 0.2s',
              }}>
              {l.flag}
            </button>
          ))}
        </div>
        <div className="sidebar-footer">{t('menu.footer')}</div>
      </aside>
      <main className="main-content">
        <PageComponent key={`${currentPage}-${pageKey}`} navigate={navigate} pageParams={pageParams} />
      </main>
    </div>
  );
}

function DBXSC AILogo() {
  return (
    <svg width="160" height="40" viewBox="0 0 160 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="5" width="30" height="30" rx="6" fill="var(--dbxsc-primary, #2563EB)"/>
      <path d="M17 12C14 12 11 15 11 19C11 23 14 27 17 27C20 27 23 23 23 19C23 15 20 12 17 12Z" fill="white" opacity="0.9"/>
      <circle cx="17" cy="19" r="3" fill="var(--dbxsc-primary, #2563EB)"/>
      <path d="M15 10L17 7L19 10" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <text x="38" y="16" fontFamily="Inter, sans-serif" fontSize="9" fontWeight="600" fill="white" opacity="0.7">Databricks</text><text x="38" y="27" fontFamily="Inter, sans-serif" fontSize="10" fontWeight="700" fill="white">Scenic</text>
      <text x="38" y="37" fontFamily="Inter, sans-serif" fontSize="10" fontWeight="700" fill="white">Crawler AI</text>
    </svg>
  );
}

export default App;
