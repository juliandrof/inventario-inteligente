import React, { useState, useEffect } from 'react';
import { fetchVideos, deleteVideo, fetchContexts } from '../api';
import { useI18n } from '../i18n';

function VideoList({ navigate }) {
  const { t } = useI18n();
  const [videos, setVideos] = useState([]);
  const [contexts, setContexts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [contextFilter, setContextFilter] = useState('');

  const loadVideos = () => {
    setLoading(true);
    fetchVideos().then(setVideos).catch(() => setVideos([])).finally(() => setLoading(false));
  };

  useEffect(() => { loadVideos(); fetchContexts().then(setContexts).catch(() => {}); }, []);

  const filtered = videos.filter(v => {
    if (filter !== 'ALL' && v.status !== filter) return false;
    if (contextFilter && v.context_name !== contextFilter) return false;
    return true;
  });

  const handleDelete = async (e, videoId) => {
    e.stopPropagation();
    if (!confirm('Delete this video and all analysis data?')) return;
    await deleteVideo(videoId); loadVideos();
  };

  if (loading) return <div className="loading"><div className="spinner"></div>{t('common.loading')}</div>;

  return (
    <div>
      <div className="page-header">
        <h1>{t('videos.title')}</h1>
        <p>{videos.length} videos</p>
      </div>

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

      {filtered.length === 0 ? (
        <div className="empty-state"><h3>{t('videos.no_videos')}</h3></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('videos.file')}</th>
                <th>{t('reports.context')}</th>
                <th>{t('videos.status')}</th>
                <th>{t('videos.progress')}</th>
                <th>{t('videos.duration')}</th>
                <th>{t('videos.score')}</th>
                <th>{t('videos.detections')}</th>
                <th>{t('videos.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v, i) => (
                <tr key={i} className="clickable" onClick={() => navigate('review', { videoId: v.video_id })}>
                  <td style={{ fontWeight: 500 }}>{v.filename}</td>
                  <td>{v.context_name ? <span className="badge badge-analyzing" style={{ fontSize: 11 }}>{v.context_name}</span> : <span style={{ color: '#999' }}>-</span>}</td>
                  <td><span className={`badge badge-${(v.status || 'pending').toLowerCase()}`}>{v.status}</span></td>
                  <td>
                    {v.status !== 'COMPLETED' && v.status !== 'FAILED' ? (
                      <div className="progress-bar" style={{ width: 80 }}><div className="progress-bar-fill" style={{ width: `${v.progress_pct || 0}%` }}></div></div>
                    ) : <span style={{ fontSize: 12, color: '#999' }}>100%</span>}
                  </td>
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
