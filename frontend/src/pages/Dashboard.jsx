import React, { useState, useEffect, useCallback } from 'react';
import { fetchDashboardSummary, fetchDashboardByCategory, fetchDashboardRecent, fetchRiskDistribution, fetchContexts, fetchTimezone } from '../api';
import { useI18n, ContextBadge } from '../i18n';

function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; }

function Dashboard({ navigate }) {
  const { t } = useI18n();
  const [summary, setSummary] = useState(null);
  const [categories, setCategories] = useState([]);
  const [recent, setRecent] = useState([]);
  const [risk, setRisk] = useState([]);
  const [loading, setLoading] = useState(true);
  const [contexts, setContexts] = useState([]);
  const [contextFilter, setContextFilter] = useState('');
  const [datePeriod, setDatePeriod] = useState('ALL');
  const [uploadFrom, setUploadFrom] = useState('');
  const [uploadTo, setUploadTo] = useState('');
  const [tz, setTz] = useState('America/Sao_Paulo');

  useEffect(() => {
    fetchContexts().then(setContexts).catch(() => {});
    fetchTimezone().then(r => { if (r.timezone) setTz(r.timezone); }).catch(() => {});
  }, []);

  const resolvedFrom = datePeriod === 'CUSTOM' ? uploadFrom : datePeriod === '30' ? daysAgo(30) : datePeriod === '60' ? daysAgo(60) : datePeriod === '90' ? daysAgo(90) : '';
  const resolvedTo = datePeriod === 'CUSTOM' ? uploadTo : '';

  const loadData = useCallback(() => {
    setLoading(true);
    const f = {};
    if (contextFilter) f.context_name = contextFilter;
    if (resolvedFrom) f.upload_from = resolvedFrom;
    if (resolvedTo) f.upload_to = resolvedTo;

    Promise.all([
      fetchDashboardSummary(f).catch(() => null),
      fetchDashboardByCategory(f).catch(() => []),
      fetchDashboardRecent(f).catch(() => []),
      fetchRiskDistribution(f).catch(() => []),
    ]).then(([s, c, r, rd]) => {
      if (s) setSummary(s);
      setCategories(c || []);
      setRecent(r || []);
      setRisk(rd || []);
      setLoading(false);
    });
  }, [contextFilter, resolvedFrom, resolvedTo]);

  useEffect(() => { loadData(); }, [loadData]);

  const s = summary || {};
  return (
    <div>
      <div className="page-header"><h1>{t('dash.title')}</h1><p>{t('dash.subtitle')}</p></div>

      {/* Filters */}
      <div className="card" style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 8 }}>
        {contexts.length > 0 && (
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>{t('reports.context')}</label>
            <select value={contextFilter} onChange={e => setContextFilter(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, minWidth: 180 }}>
              <option value="">{t('reports.all_contexts')}</option>
              {contexts.map(c => <option key={c.context_id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>{t('reports.period')}</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['ALL',t('reports.all')],['30',t('reports.days_30')],['60',t('reports.days_60')],['90',t('reports.days_90')],['CUSTOM',t('reports.custom')]].map(([k,l]) => (
              <button key={k} className={`btn btn-sm ${datePeriod === k ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => { setDatePeriod(k); if (k !== 'CUSTOM') { setUploadFrom(''); setUploadTo(''); } }}>{l}</button>
            ))}
          </div>
        </div>
        {datePeriod === 'CUSTOM' && (
          <>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>{t('reports.from')}</label>
              <input type="date" value={uploadFrom} onChange={e => setUploadFrom(e.target.value)}
                style={{ padding: '7px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>{t('reports.to')}</label>
              <input type="date" value={uploadTo} onChange={e => setUploadTo(e.target.value)}
                style={{ padding: '7px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }} />
            </div>
          </>
        )}
      </div>

      {loading ? <div className="loading"><div className="spinner"></div>{t('common.loading')}</div> : (
        <>
          <div className="stat-cards">
            <div className="stat-card info"><div className="stat-value">{s.total_videos || 0}</div><div className="stat-label">{t('dash.total_videos')}</div></div>
            <div className="stat-card"><div className="stat-value">{s.total_detections || 0}</div><div className="stat-label">{t('dash.total_detections')}</div></div>
            <div className="stat-card warning"><div className="stat-value">{s.pending_reviews || 0}</div><div className="stat-label">{t('dash.pending_reviews')}</div></div>
            <div className="stat-card success"><div className="stat-value">{s.confirmed_detections || 0}</div><div className="stat-label">{t('dash.confirmed')}</div></div>
            <div className="stat-card danger"><div className="stat-value">{s.avg_risk_score || 0}</div><div className="stat-label">{t('dash.avg_score')}</div></div>
          </div>

          <div className="two-cols">
            <div className="card">
              <div className="card-title">{t('dash.by_category')}</div>
              {categories.length === 0 ? <p style={{ color: '#999', fontSize: 14 }}>{t('dash.no_detections')}</p> : (
                <div>{categories.map((c, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div style={{ width: 120, fontWeight: 500, textTransform: 'capitalize', fontSize: 14 }}>{c.category}</div>
                    <div style={{ flex: 1, height: 24, background: '#f0f0f0', borderRadius: 12, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, (c.cnt / Math.max(...categories.map(x => x.cnt))) * 100)}%`, height: '100%', background: 'var(--dbxsc-primary)', borderRadius: 12 }}></div>
                    </div>
                    <div style={{ width: 40, textAlign: 'right', fontWeight: 600, fontSize: 14 }}>{c.cnt}</div>
                    <div style={{ width: 50, textAlign: 'right', fontSize: 12, color: '#999' }}>avg {typeof c.avg_score === 'number' ? c.avg_score.toFixed(1) : c.avg_score}</div>
                  </div>
                ))}</div>
              )}
            </div>
            <div className="card">
              <div className="card-title">{t('dash.score_dist')}</div>
              {risk.length === 0 ? <p style={{ color: '#999', fontSize: 14 }}>{t('dash.no_detections')}</p> : (
                <div>{risk.map((r, i) => {
                  const colors = { 'Baixo (0-3)': '#27ae60', 'Medio (4-6)': '#f39c12', 'Alto (7-8)': '#e67e22', 'Critico (9-10)': '#e74c3c' };
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                      <div style={{ width: 120, fontSize: 13, fontWeight: 500 }}>{r.risk_level}</div>
                      <div style={{ flex: 1, height: 24, background: '#f0f0f0', borderRadius: 12, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, (r.cnt / Math.max(...risk.map(x => x.cnt))) * 100)}%`, height: '100%', background: colors[r.risk_level] || '#999', borderRadius: 12 }}></div>
                      </div>
                      <div style={{ width: 40, textAlign: 'right', fontWeight: 600 }}>{r.cnt}</div>
                    </div>
                  );
                })}</div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('dash.recent')}</div>
            {recent.length === 0 ? (
              <div className="empty-state">
                <h3>{t('dash.no_videos')}</h3>
                <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('upload')}>{t('dash.upload_btn')}</button>
              </div>
            ) : (
              <table className="data-table">
                <thead><tr><th>{t('videos.file')}</th><th>{t('reports.context')}</th><th>{t('videos.status')}</th><th>{t('videos.duration')}</th><th>{t('videos.score')}</th><th>{t('videos.detections')}</th><th>{t('reports.upload_date')}</th></tr></thead>
                <tbody>{recent.map((v, i) => (
                  <tr key={i} className="clickable" onClick={() => navigate('review', { videoId: v.video_id })}>
                    <td style={{ fontWeight: 500 }}>{v.filename}</td>
                    <td><ContextBadge name={v.context_name} color={v.context_color} /></td>
                    <td><span className={`badge badge-${(v.status || 'pending').toLowerCase()}`}>{v.status}</span></td>
                    <td>{v.duration_seconds ? `${Math.round(v.duration_seconds)}s` : '-'}</td>
                    <td>{v.overall_risk ? <span className={`score-gauge ${sc(v.overall_risk)}`}>{typeof v.overall_risk === 'number' ? v.overall_risk.toFixed(1) : v.overall_risk}</span> : '-'}</td>
                    <td>{v.total_detections || 0}</td>
                    <td style={{ fontSize: 12, color: '#999' }}>{fmtDate(v.upload_timestamp, tz)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function sc(s) { return s <= 3 ? 'score-low' : s <= 6 ? 'score-medium' : s <= 8 ? 'score-high' : 'score-critical'; }
function fmtDate(ts, tz) { if (!ts) return '-'; try { return new Date(ts).toLocaleString('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ts; } }
export default Dashboard;
