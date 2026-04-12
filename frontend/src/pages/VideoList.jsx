import React, { useState, useEffect } from 'react';
import { fetchVideos, deleteVideo } from '../api';
import { useI18n } from '../i18n';

function VideoList({ navigate }) {
  const { t } = useI18n();
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');

  const loadVideos = () => {
    setLoading(true);
    fetchVideos()
      .then(setVideos)
      .catch(() => setVideos([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadVideos(); }, []);

  const filtered = filter === 'ALL' ? videos : videos.filter(v => v.status === filter);

  const handleDelete = async (e, videoId) => {
    e.stopPropagation();
    if (!confirm('Tem certeza que deseja excluir este video e todos os dados de analise?')) return;
    await deleteVideo(videoId);
    loadVideos();
  };

  if (loading) return <div className="loading"><div className="spinner"></div>{t('common.loading')}</div>;

  return (
    <div>
      <div className="page-header">
        <h1>{t('videos.title')}</h1>
        <p>{videos.length} videos no sistema</p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['ALL', 'PENDING', 'SCANNING', 'ANALYZING', 'COMPLETED', 'FAILED'].map(s => (
          <button
            key={s}
            className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter(s)}
          >
            {s === 'ALL' ? t('videos.all') : s}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <h3>{t('videos.no_videos')}</h3>
          <p>Faca upload ou inicie um processamento em batch</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('videos.file')}</th>
                <th>{t('videos.status')}</th>
                <th>{t('videos.progress')}</th>
                <th>{t('videos.duration')}</th>
                <th>{t('videos.score')}</th>
                <th>{t('videos.detections')}</th>
                <th>{t('videos.source')}</th>
                <th>{t('videos.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v, i) => (
                <tr key={i} className="clickable" onClick={() => navigate('review', { videoId: v.video_id })}>
                  <td style={{ fontWeight: 500 }}>{v.filename}</td>
                  <td>
                    <span className={`badge badge-${(v.status || 'pending').toLowerCase()}`}>{v.status}</span>
                  </td>
                  <td>
                    {v.status !== 'COMPLETED' && v.status !== 'FAILED' ? (
                      <div className="progress-bar" style={{ width: 80 }}>
                        <div className="progress-bar-fill" style={{ width: `${v.progress_pct || 0}%` }}></div>
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: '#999' }}>100%</span>
                    )}
                  </td>
                  <td>{v.duration_seconds ? `${Math.round(v.duration_seconds)}s` : '-'}</td>
                  <td>
                    {v.overall_risk ? (
                      <span className={`score-gauge ${getScoreClass(v.overall_risk)}`}>
                        {typeof v.overall_risk === 'number' ? v.overall_risk.toFixed(1) : v.overall_risk}
                      </span>
                    ) : '-'}
                  </td>
                  <td>{v.total_detections || 0}</td>
                  <td style={{ fontSize: 12 }}>{v.source || '-'}</td>
                  <td>
                    <button className="btn btn-sm btn-danger" onClick={(e) => handleDelete(e, v.video_id)}>
                      {t('videos.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function getScoreClass(score) {
  if (score <= 3) return 'score-low';
  if (score <= 6) return 'score-medium';
  if (score <= 8) return 'score-high';
  return 'score-critical';
}

export default VideoList;
