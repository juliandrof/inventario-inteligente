import React, { useState, useEffect, useRef } from 'react';
import { stopStream, restartStream, updateStream, deleteStream, fetchStreamLogs, fetchStreams, fetchVideos } from '../api';
import { useI18n, ContextBadge } from '../i18n';

function Streaming({ navigate }) {
  const { t } = useI18n();
  const [tab, setTab] = useState('streams');
  const [streams, setStreams] = useState([]);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedStream, setExpandedStream] = useState(null);
  const [logsPanel, setLogsPanel] = useState(null); // stream_id or null
  const [logs, setLogs] = useState([]);

  const [error, setError] = useState('');

  // Edit state
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editWindow, setEditWindow] = useState(60);

  const loadRef = useRef(false);
  const load = () => {
    if (!loadRef.current) setLoading(true);
    Promise.all([
      fetchStreams().catch(() => []),
      fetchVideos().catch(() => []),
    ]).then(([s, v]) => {
      setStreams(s || []); setVideos(v || []);
      setLoading(false); loadRef.current = true;
    });
  };
  useEffect(() => { load(); const iv = setInterval(load, 8000); return () => clearInterval(iv); }, []);

  // Load logs when panel is open
  useEffect(() => {
    if (!logsPanel) return;
    const loadLogs = () => fetchStreamLogs(logsPanel).then(setLogs).catch(() => setLogs([]));
    loadLogs();
    const iv = setInterval(loadLogs, 3000);
    return () => clearInterval(iv);
  }, [logsPanel]);

  // Group stream videos by stream_id
  const streamGroups = {};
  for (const s of streams) {
    const sid = String(s.stream_id);
    streamGroups[sid] = { ...s, id: sid, videoList: [] };
  }
  for (const v of videos) {
    if (v.source === 'STREAM') {
      const match = v.filename.match(/^stream_(\d+)_/);
      if (match) {
        const sid = match[1];
        if (streamGroups[sid]) {
          streamGroups[sid].videoList.push(v);
        }
      }
    }
  }
  const groupList = Object.values(streamGroups).sort((a, b) => Number(b.id) - Number(a.id));

  const handleStop = async (e, streamId) => {
    e.stopPropagation();
    await stopStream(streamId); load();
  };

  const handleRestart = async (e, streamId) => {
    e.stopPropagation();
    await restartStream(streamId); load();
  };

  const handleDelete = async (e, streamId) => {
    e.stopPropagation();
    if (!confirm(t('streaming.confirm_delete'))) return;
    await deleteStream(streamId); load();
  };

  const handleSaveEdit = async (streamId) => {
    await updateStream(streamId, { name: editName, stream_url: editUrl, window_seconds: editWindow });
    setEditingId(null); load();
  };

  const startEdit = (e, g) => {
    e.stopPropagation();
    setEditingId(Number(g.id));
    setEditName(g.name || '');
    setEditUrl(g.stream_url || '');
    setEditWindow(g.window_seconds || 60);
  };

  if (loading) return <div className="loading"><div className="spinner"></div>{t('common.loading')}</div>;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><h1>{t('process.stream_title')}</h1><p>{t('streaming.subtitle')}</p></div>
        <button className="btn btn-primary" onClick={() => navigate('process')}>
          {t('streaming.new')}
        </button>
      </div>

      {/* STREAMS LIST */}
      {(
        groupList.length === 0 ? (
          <div className="empty-state">
            <h3>{t('streaming.no_streams')}</h3>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setTab('new')}>{t('streaming.new')}</button>
          </div>
        ) : (
          <div>
            {groupList.map(g => {
              const isLive = g.status === 'RUNNING' || g.status === 'CONNECTING';
              const isStopped = g.status === 'STOPPED' || g.status === 'COMPLETED' || g.status === 'FAILED';
              const totalDet = g.videoList.reduce((sum, v) => sum + (v.total_detections || 0), 0);
              const maxScore = Math.max(0, ...g.videoList.map(v => v.overall_risk || 0));
              const isExpanded = expandedStream === g.id;
              const isEditing = editingId === Number(g.id);
              const showLogs = logsPanel === Number(g.id);

              return (
                <div key={g.id} className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 8 }}>
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', padding: '14px 20px', cursor: 'pointer', gap: 12 }}
                    onClick={() => setExpandedStream(isExpanded ? null : g.id)}>
                    {isLive && <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#e74c3c', flexShrink: 0, animation: 'pulse 1.5s infinite' }}></span>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name || `Stream #${g.id}`}</span>
                        <span style={{ fontWeight: 400, fontSize: 12, color: '#999', flexShrink: 0 }}>{g.videoList.length} {t('process.stream_windows').toLowerCase()}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                        {g.context_name && <ContextBadge name={g.context_name} color={g.context_color} style={{ fontSize: 10 }} />}
                        <span style={{ fontSize: 11, color: '#999', fontFamily: 'monospace' }}>{g.stream_url}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {totalDet > 0 && <span style={{ fontSize: 13 }}>{totalDet} det.</span>}
                      {maxScore > 0 && <span className={`score-gauge ${sc(maxScore)}`} style={{ width: 32, height: 32, fontSize: 12 }}>{maxScore.toFixed(1)}</span>}
                      <span className={`badge ${isLive ? 'badge-scanning' : g.status === 'FAILED' ? 'badge-failed' : 'badge-completed'}`}>
                        {isLive ? 'LIVE' : g.status}
                      </span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: 6, padding: '0 20px 12px', flexWrap: 'wrap' }}>
                    {isLive && <button className="btn btn-sm btn-danger" onClick={e => handleStop(e, Number(g.id))}>{t('process.stream_stop')}</button>}
                    {isStopped && <button className="btn btn-sm btn-primary" onClick={e => handleRestart(e, Number(g.id))}>{t('streaming.restart')}</button>}
                    <button className="btn btn-sm btn-secondary" onClick={e => startEdit(e, g)}>{t('streaming.edit')}</button>
                    <button className="btn btn-sm btn-secondary" onClick={e => { e.stopPropagation(); setLogsPanel(showLogs ? null : Number(g.id)); }}>
                      {t('streaming.logs')}
                    </button>
                    <button className="btn btn-sm btn-danger" style={{ marginLeft: 'auto' }} onClick={e => handleDelete(e, Number(g.id))}>{t('streaming.delete')}</button>
                    <span style={{ fontSize: 18, color: '#999', cursor: 'pointer', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}
                      onClick={(e) => { e.stopPropagation(); setExpandedStream(isExpanded ? null : g.id); }}>v</span>
                  </div>

                  {/* Edit panel */}
                  {isEditing && (
                    <div style={{ borderTop: '1px solid #eee', padding: 16, background: '#fafafa' }}>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <div className="form-group" style={{ flex: 2, minWidth: 180, marginBottom: 0 }}>
                          <label style={{ fontSize: 12 }}>{t('streaming.stream_name')}</label>
                          <input type="text" value={editName} onChange={e => setEditName(e.target.value)} />
                        </div>
                        <div className="form-group" style={{ flex: 3, minWidth: 220, marginBottom: 0 }}>
                          <label style={{ fontSize: 12 }}>URL</label>
                          <input type="text" value={editUrl} onChange={e => setEditUrl(e.target.value)} style={{ fontFamily: 'monospace' }} />
                        </div>
                        <div className="form-group" style={{ width: 100, marginBottom: 0 }}>
                          <label style={{ fontSize: 12 }}>{t('process.stream_window_label')}</label>
                          <input type="number" min="10" max="600" value={editWindow} onChange={e => setEditWindow(Number(e.target.value))} />
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-sm btn-primary" onClick={() => handleSaveEdit(Number(g.id))}>{t('streaming.save')}</button>
                          <button className="btn btn-sm btn-secondary" onClick={() => setEditingId(null)}>{t('streaming.cancel')}</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Logs panel */}
                  {showLogs && (
                    <div style={{ borderTop: '1px solid #eee', padding: '12px 20px', background: '#1a1a2e', maxHeight: 250, overflowY: 'auto' }}>
                      <div style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7 }}>
                        {logs.length === 0 ? (
                          <span style={{ color: '#666' }}>{t('streaming.no_logs')}</span>
                        ) : (
                          logs.map((l, i) => (
                            <div key={i}>
                              <span style={{ color: '#666' }}>{l.ts}</span>{' '}
                              <span style={{ color: l.level === 'ERROR' ? '#e74c3c' : l.level === 'WARN' ? '#f39c12' : l.level === 'OK' ? '#27ae60' : l.level === 'DETECTION' ? '#e67e22' : '#8899aa', fontWeight: 600 }}>
                                [{l.level}]
                              </span>{' '}
                              <span style={{ color: '#ccc' }}>{l.msg}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* Videos table */}
                  {isExpanded && g.videoList.length > 0 && (
                    <div style={{ borderTop: '1px solid #eee' }}>
                      <table className="data-table">
                        <thead><tr><th>{t('process.stream_window')}</th><th>{t('videos.status')}</th><th>{t('videos.duration')}</th><th>{t('videos.score')}</th><th>{t('videos.detections')}</th><th>{t('videos.actions')}</th></tr></thead>
                        <tbody>
                          {g.videoList.map((v, i) => (
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
                  {isExpanded && g.videoList.length === 0 && (
                    <div style={{ borderTop: '1px solid #eee', padding: '20px', textAlign: 'center', color: '#999', fontSize: 13 }}>
                      {t('streaming.no_windows_yet')}
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
