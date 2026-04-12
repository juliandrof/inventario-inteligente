import React, { useState, useEffect, useRef } from 'react';
import { startStream, stopStream, fetchStreams, fetchContexts, fetchVideos } from '../api';
import { useI18n, ContextBadge } from '../i18n';

function Streaming({ navigate }) {
  const { t } = useI18n();
  const [tab, setTab] = useState('streams'); // streams | new
  const [streams, setStreams] = useState([]);
  const [videos, setVideos] = useState([]);
  const [contexts, setContexts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedStream, setExpandedStream] = useState(null);

  // New stream state
  const [contextId, setContextId] = useState(0);
  const [contextName, setContextName] = useState('');
  const [contextColor, setContextColor] = useState('');
  const [streamUrl, setStreamUrl] = useState('');
  const [streamWindow, setStreamWindow] = useState(60);
  const [streamUser, setStreamUser] = useState('');
  const [streamPass, setStreamPass] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [activeStream, setActiveStream] = useState(null);
  const esRef = useRef(null);

  const loadRef = useRef(false);
  const load = () => {
    if (!loadRef.current) setLoading(true);
    Promise.all([
      fetchStreams().catch(() => []),
      fetchVideos().catch(() => []),
      fetchContexts().catch(() => []),
    ]).then(([s, v, c]) => {
      setStreams(s || []); setVideos(v || []); setContexts(c || []);
      setLoading(false); loadRef.current = true;
    });
  };
  useEffect(() => { load(); const iv = setInterval(load, 8000); return () => { clearInterval(iv); if (esRef.current) esRef.current.close(); }; }, []);

  // Group stream videos
  const streamGroups = {};
  for (const v of videos) {
    if (v.source === 'STREAM') {
      const match = v.filename.match(/^stream_(\d+)_/);
      if (match) {
        const sid = match[1];
        if (!streamGroups[sid]) streamGroups[sid] = { id: sid, videos: [], context_name: v.context_name, context_color: v.context_color };
        streamGroups[sid].videos.push(v);
        if (v.context_color) streamGroups[sid].context_color = v.context_color;
      }
    }
  }
  for (const s of streams) {
    const sid = String(s.stream_id);
    if (!streamGroups[sid]) streamGroups[sid] = { id: sid, videos: [], context_name: s.context_name, context_color: '' };
    streamGroups[sid].stream = s;
  }
  const groupList = Object.values(streamGroups).sort((a, b) => Number(b.id) - Number(a.id));

  const handleStop = async (e, streamId) => {
    e.stopPropagation();
    await stopStream(streamId); load();
  };

  const handleStart = async () => {
    if (!streamUrl.trim() || !contextId) return;
    setError(''); setStarting(true);
    try {
      const res = await startStream(streamUrl.trim(), contextId, streamWindow, streamUser, streamPass);
      setActiveStream(res); setTab('streams');
      load();
    } catch (e) { setError(e.message || t('common.error')); } finally { setStarting(false); }
  };

  const selectContext = (id) => {
    setContextId(id);
    const ctx = contexts.find(c => c.context_id === id);
    setContextName(ctx ? ctx.name : '');
    setContextColor(ctx ? ctx.color || '#2563EB' : '');
  };

  if (loading) return <div className="loading"><div className="spinner"></div>{t('common.loading')}</div>;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><h1>{t('process.stream_title')}</h1><p>{t('streaming.subtitle')}</p></div>
        <button className="btn btn-primary" onClick={() => { setTab(tab === 'new' ? 'streams' : 'new'); setContextId(0); setStreamUrl(''); }}>
          {tab === 'new' ? t('review.back') : t('streaming.new')}
        </button>
      </div>

      {/* NEW STREAM WIZARD */}
      {tab === 'new' && (
        <div>
          {!contextId ? (
            <div className="card">
              <div className="card-title">{t('process.step1')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginTop: 12 }}>
                {contexts.map(ctx => {
                  let cats = ctx.categories;
                  if (typeof cats === 'string') try { cats = JSON.parse(cats); } catch { cats = []; }
                  return (
                    <div key={ctx.context_id} onClick={() => selectContext(ctx.context_id)}
                      style={{ padding: 16, borderRadius: 12, border: '2px solid #e0e0e0', cursor: 'pointer', transition: 'all 0.2s', background: 'white' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--dbxsc-primary)'; e.currentTarget.style.transform = 'scale(1.02)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#e0e0e0'; e.currentTarget.style.transform = 'scale(1)'; }}>
                      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{ctx.name}</div>
                      {ctx.description && <p style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>{ctx.description}</p>}
                      <div className="category-tags">{cats.map((c, i) => <span key={i} className="category-tag" style={{ fontSize: 11, textTransform: 'capitalize' }}>{c}</span>)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div>
              <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <span style={{ fontSize: 12, color: '#999', marginRight: 8 }}>{t('process.context')}:</span>
                  <ContextBadge name={contextName} color={contextColor} style={{ fontSize: 13 }} />
                </div>
                <button className="btn btn-sm btn-secondary" onClick={() => setContextId(0)}>{t('process.change_context')}</button>
              </div>
              <div className="card">
                <div className="form-group">
                  <label>{t('process.stream_url')}</label>
                  <input type="text" value={streamUrl} onChange={e => setStreamUrl(e.target.value)}
                    placeholder="rtsp://camera-ip:554/stream1" style={{ fontFamily: 'monospace' }} />
                </div>
                {streamUrl.toLowerCase().startsWith('rtsp://') && (
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ flex: 1, minWidth: 160 }}>
                      <label>{t('streaming.username')}</label>
                      <input type="text" value={streamUser} onChange={e => setStreamUser(e.target.value)}
                        placeholder="admin" autoComplete="username" />
                    </div>
                    <div className="form-group" style={{ flex: 1, minWidth: 160 }}>
                      <label>{t('streaming.password')}</label>
                      <input type="password" value={streamPass} onChange={e => setStreamPass(e.target.value)}
                        placeholder="********" autoComplete="current-password" />
                    </div>
                  </div>
                )}
                <div className="form-group" style={{ maxWidth: 250 }}>
                  <label>{t('process.stream_window_label')}</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="number" min="10" max="600" value={streamWindow} onChange={e => setStreamWindow(Number(e.target.value))} style={{ width: 80 }} />
                    <span style={{ fontSize: 13, color: '#999' }}>{t('process.stream_window_unit')}</span>
                  </div>
                </div>
                <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
                  <div style={{ fontWeight: 500, marginBottom: 6 }}>{t('process.stream_protocols')}</div>
                  <div style={{ color: '#666', lineHeight: 1.8 }}>
                    <code style={{ background: '#e8e8e8', padding: '2px 6px', borderRadius: 4 }}>rtsp://</code> — {t('process.stream_rtsp')}<br/>
                    <code style={{ background: '#e8e8e8', padding: '2px 6px', borderRadius: 4 }}>rtmp://</code> — {t('process.stream_rtmp')}<br/>
                    <code style={{ background: '#e8e8e8', padding: '2px 6px', borderRadius: 4 }}>http(s)://</code> — {t('process.stream_http')}<br/>
                    <code style={{ background: '#e8e8e8', padding: '2px 6px', borderRadius: 4 }}>/Volumes/...</code> — {t('process.stream_mock')}
                  </div>
                  <div style={{ marginTop: 8, padding: '8px 10px', background: '#e8f5e9', borderRadius: 6, color: '#2e7d32' }}>
                    <strong>{t('process.stream_test_label')}</strong><br/>
                    <code style={{ fontSize: 12 }}>/Volumes/jsf_dbxsc_demo/main/test_videos/motorista_fadiga_severa.mp4</code>
                  </div>
                </div>
                <button className="btn btn-primary" onClick={handleStart} disabled={starting || !streamUrl.trim()}>
                  {starting ? t('batch.starting') : t('process.stream_start')}
                </button>
                {error && <p style={{ color: 'var(--dbxsc-danger)', marginTop: 8, fontSize: 13 }}>{error}</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* STREAMS LIST */}
      {tab === 'streams' && (
        groupList.length === 0 ? (
          <div className="empty-state">
            <h3>{t('streaming.no_streams')}</h3>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setTab('new')}>{t('streaming.new')}</button>
          </div>
        ) : (
          <div>
            {groupList.map(g => {
              const isLive = g.stream && (g.stream.status === 'RUNNING' || g.stream.status === 'CONNECTING');
              const totalDet = g.videos.reduce((sum, v) => sum + (v.total_detections || 0), 0);
              const maxScore = Math.max(0, ...g.videos.map(v => v.overall_risk || 0));
              const isExpanded = expandedStream === g.id;

              return (
                <div key={g.id} className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', padding: '14px 20px', cursor: 'pointer', gap: 12 }}
                    onClick={() => setExpandedStream(isExpanded ? null : g.id)}>
                    {isLive && <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#e74c3c', flexShrink: 0, animation: 'pulse 1.5s infinite' }}></span>}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        Streaming #{g.id}
                        <span style={{ fontWeight: 400, fontSize: 12, color: '#999', marginLeft: 8 }}>{g.videos.length} {t('process.stream_windows').toLowerCase()}</span>
                      </div>
                      {g.context_name && <ContextBadge name={g.context_name} color={g.context_color} style={{ fontSize: 10, marginTop: 2 }} />}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {totalDet > 0 && <span style={{ fontSize: 13 }}>{totalDet} det.</span>}
                      {maxScore > 0 && <span className={`score-gauge ${sc(maxScore)}`} style={{ width: 32, height: 32, fontSize: 12 }}>{maxScore.toFixed(1)}</span>}
                      <span className={`badge ${isLive ? 'badge-scanning' : 'badge-completed'}`}>{isLive ? 'LIVE' : 'COMPLETED'}</span>
                      {isLive && <button className="btn btn-sm btn-danger" onClick={e => handleStop(e, g.stream.stream_id)}>{t('process.stream_stop')}</button>}
                      <span style={{ fontSize: 18, color: '#999', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>v</span>
                    </div>
                  </div>
                  {isExpanded && g.videos.length > 0 && (
                    <div style={{ borderTop: '1px solid #eee' }}>
                      <table className="data-table">
                        <thead><tr><th>{t('process.stream_window')}</th><th>{t('videos.status')}</th><th>{t('videos.duration')}</th><th>{t('videos.score')}</th><th>{t('videos.detections')}</th><th>{t('videos.actions')}</th></tr></thead>
                        <tbody>
                          {g.videos.map((v, i) => (
                            <tr key={i} className="clickable" onClick={() => navigate('review', { videoId: v.video_id })}>
                              <td style={{ fontWeight: 500 }}>{v.filename.replace(/^stream_\d+_/, '')}</td>
                              <td><span className={`badge badge-${(v.status || 'pending').toLowerCase()}`}>{v.status}</span></td>
                              <td>{v.duration_seconds ? `${Math.round(v.duration_seconds)}s` : '-'}</td>
                              <td>{v.overall_risk != null ? <span className={`score-gauge ${sc(v.overall_risk)}`}>{typeof v.overall_risk === 'number' ? v.overall_risk.toFixed(1) : v.overall_risk}</span> : '-'}</td>
                              <td>{v.total_detections || 0}</td>
                              <td>{v.total_detections > 0 && <button className="btn btn-sm btn-primary" onClick={e => { e.stopPropagation(); navigate('review', { videoId: v.video_id }); }}>{t('batch.review_btn')}</button>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
            <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
          </div>
        )
      )}
    </div>
  );
}

function sc(s) { return s <= 3 ? 'score-low' : s <= 6 ? 'score-medium' : s <= 8 ? 'score-high' : 'score-critical'; }
export default Streaming;
