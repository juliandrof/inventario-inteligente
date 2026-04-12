import React, { useState, useEffect } from 'react';
import { fetchVideos, deleteVideo, fetchContexts, fetchStreams, stopStream } from '../api';
import { useI18n, ContextBadge } from '../i18n';

function VideoList({ navigate }) {
  const { t } = useI18n();
  const [videos, setVideos] = useState([]);
  const [streams, setStreams] = useState([]);
  const [contexts, setContexts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [contextFilter, setContextFilter] = useState('');
  const [expandedStream, setExpandedStream] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      fetchVideos().catch(() => []),
      fetchStreams().catch(() => []),
      fetchContexts().catch(() => []),
    ]).then(([v, s, c]) => {
      setVideos(v || []); setStreams(s || []); setContexts(c || []);
      setLoading(false);
    });
  };
  useEffect(() => { load(); const iv = setInterval(load, 10000); return () => clearInterval(iv); }, []);

  // Separate stream videos from regular videos
  const streamVideoIds = new Set();
  const activeStreams = streams.filter(s => s.status === 'RUNNING' || s.status === 'CONNECTING');

  // Group stream windows by stream prefix
  const streamGroups = {};
  const regularVideos = [];
  for (const v of videos) {
    if (v.source === 'STREAM') {
      const match = v.filename.match(/^stream_(\d+)_/);
      if (match) {
        const sid = match[1];
        if (!streamGroups[sid]) streamGroups[sid] = { id: sid, videos: [], context_name: v.context_name };
        streamGroups[sid].videos.push(v);
        continue;
      }
    }
    regularVideos.push(v);
  }

  // Add active streams that may not have windows yet
  for (const s of activeStreams) {
    const sid = String(s.stream_id);
    if (!streamGroups[sid]) streamGroups[sid] = { id: sid, videos: [], context_name: s.context_name };
    streamGroups[sid].stream = s;
  }

  const filtered = regularVideos.filter(v => {
    if (filter !== 'ALL' && v.status !== filter) return false;
    if (contextFilter && v.context_name !== contextFilter) return false;
    return true;
  });

  const filteredStreamGroups = Object.values(streamGroups).filter(g => {
    if (contextFilter && g.context_name !== contextFilter) return false;
    return true;
  });

  const handleDelete = async (e, videoId) => {
    e.stopPropagation();
    if (!confirm('Delete?')) return;
    await deleteVideo(videoId); load();
  };

  const handleStopStream = async (e, streamId) => {
    e.stopPropagation();
    await stopStream(streamId); load();
  };

  if (loading) return <div className="loading"><div className="spinner"></div>{t('common.loading')}</div>;

  return (
    <div>
      <div className="page-header"><h1>{t('videos.title')}</h1><p>{videos.length} videos</p></div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {['ALL', 'PENDING', 'SCANNING', 'ANALYZING', 'COMPLETED', 'FAILED'].map(s => (
          <button key={s} className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(s)}>
            {s === 'ALL' ? t('videos.all') : s}
          </button>
        ))}
        {contexts.length > 0 && (
          <>
            <span style={{ color: '#ccc', margin: '0 4px' }}>|</span>
            <select value={contextFilter} onChange={e => setContextFilter(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }}>
              <option value="">{t('reports.all_contexts')}</option>
              {contexts.map(c => <option key={c.context_id} value={c.name}>{c.name}</option>)}
            </select>
          </>
        )}
      </div>

      {/* Active / Recent Streams */}
      {filteredStreamGroups.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {filteredStreamGroups.map(g => {
            const isLive = g.stream && (g.stream.status === 'RUNNING' || g.stream.status === 'CONNECTING');
            const totalDet = g.videos.reduce((sum, v) => sum + (v.total_detections || 0), 0);
            const maxScore = Math.max(0, ...g.videos.map(v => v.overall_risk || 0));
            const isExpanded = expandedStream === g.id;

            return (
              <div key={g.id} className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 8 }}>
                {/* Stream header row */}
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
                    {totalDet > 0 && <span style={{ fontSize: 13 }}>{totalDet} {t('videos.detections').toLowerCase()}</span>}
                    {maxScore > 0 && <span className={`score-gauge ${sc(maxScore)}`} style={{ width: 32, height: 32, fontSize: 12 }}>{maxScore.toFixed(1)}</span>}
                    <span className={`badge ${isLive ? 'badge-scanning' : 'badge-completed'}`}>{isLive ? 'LIVE' : 'COMPLETED'}</span>
                    {isLive && <button className="btn btn-sm btn-danger" onClick={e => handleStopStream(e, g.stream.stream_id)}>{t('process.stream_stop')}</button>}
                    <span style={{ fontSize: 18, color: '#999', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>v</span>
                  </div>
                </div>

                {/* Expanded: window detail table */}
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
                            <td><button className="btn btn-sm btn-danger" onClick={e => handleDelete(e, v.video_id)}>{t('videos.delete')}</button></td>
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
      )}

      {/* Regular videos */}
      {filtered.length === 0 && filteredStreamGroups.length === 0 ? (
        <div className="empty-state"><h3>{t('videos.no_videos')}</h3></div>
      ) : filtered.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr><th>{t('videos.file')}</th><th>{t('reports.context')}</th><th>{t('videos.status')}</th><th>{t('videos.progress')}</th><th>{t('videos.duration')}</th><th>{t('videos.score')}</th><th>{t('videos.detections')}</th><th>{t('videos.actions')}</th></tr>
            </thead>
            <tbody>
              {filtered.map((v, i) => (
                <tr key={i} className="clickable" onClick={() => navigate('review', { videoId: v.video_id })}>
                  <td style={{ fontWeight: 500 }}>{v.filename}</td>
                  <td><ContextBadge name={v.context_name} color={v.context_color} /></td>
                  <td><span className={`badge badge-${(v.status || 'pending').toLowerCase()}`}>{v.status}</span></td>
                  <td>{v.status !== 'COMPLETED' && v.status !== 'FAILED' ? <div className="progress-bar" style={{ width: 80 }}><div className="progress-bar-fill" style={{ width: `${v.progress_pct || 0}%` }}></div></div> : <span style={{ fontSize: 12, color: '#999' }}>100%</span>}</td>
                  <td>{v.duration_seconds ? `${Math.round(v.duration_seconds)}s` : '-'}</td>
                  <td>{v.overall_risk != null ? <span className={`score-gauge ${sc(v.overall_risk)}`}>{typeof v.overall_risk === 'number' ? v.overall_risk.toFixed(1) : v.overall_risk}</span> : '-'}</td>
                  <td>{v.total_detections || 0}</td>
                  <td><button className="btn btn-sm btn-danger" onClick={e => handleDelete(e, v.video_id)}>{t('videos.delete')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function sc(s) { return s <= 3 ? 'score-low' : s <= 6 ? 'score-medium' : s <= 8 ? 'score-high' : 'score-critical'; }
export default VideoList;
