import React, { useState, useEffect } from 'react';
import { fetchDashboardSummary, fetchDashboardByCategory, fetchDashboardRecent, fetchRiskDistribution } from '../api';

function Dashboard({ navigate }) {
  const [summary, setSummary] = useState(null);
  const [categories, setCategories] = useState([]);
  const [recent, setRecent] = useState([]);
  const [risk, setRisk] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchDashboardSummary().catch(() => null),
      fetchDashboardByCategory().catch(() => []),
      fetchDashboardRecent().catch(() => []),
      fetchRiskDistribution().catch(() => []),
    ]).then(([s, c, r, rd]) => {
      if (s) setSummary(s);
      setCategories(c || []);
      setRecent(r || []);
      setRisk(rd || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="loading"><div className="spinner"></div>Carregando dashboard...</div>;

  const s = summary || {};
  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>Visao geral do monitoramento de seguranca</p>
      </div>

      <div className="stat-cards">
        <div className="stat-card info">
          <div className="stat-value">{s.total_videos || 0}</div>
          <div className="stat-label">Videos Analisados</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{s.total_detections || 0}</div>
          <div className="stat-label">Deteccoes Totais</div>
        </div>
        <div className="stat-card warning">
          <div className="stat-value">{s.pending_reviews || 0}</div>
          <div className="stat-label">Pendentes de Revisao</div>
        </div>
        <div className="stat-card success">
          <div className="stat-value">{s.confirmed_detections || 0}</div>
          <div className="stat-label">Confirmadas</div>
        </div>
        <div className="stat-card danger">
          <div className="stat-value">{s.avg_risk_score || 0}</div>
          <div className="stat-label">Score Medio de Risco</div>
        </div>
      </div>

      <div className="two-cols">
        <div className="card">
          <div className="card-title">Deteccoes por Categoria</div>
          {categories.length === 0 ? (
            <p style={{ color: '#999', fontSize: 14 }}>Nenhuma deteccao ainda</p>
          ) : (
            <div>
              {categories.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 120, fontWeight: 500, textTransform: 'capitalize', fontSize: 14 }}>{c.category}</div>
                  <div style={{ flex: 1, height: 24, background: '#f0f0f0', borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.min(100, (c.cnt / Math.max(...categories.map(x => x.cnt))) * 100)}%`,
                      height: '100%',
                      background: 'var(--dbxsc-primary)',
                      borderRadius: 12,
                      transition: 'width 0.5s ease',
                    }}></div>
                  </div>
                  <div style={{ width: 40, textAlign: 'right', fontWeight: 600, fontSize: 14 }}>{c.cnt}</div>
                  <div style={{ width: 50, textAlign: 'right', fontSize: 12, color: '#999' }}>
                    avg {typeof c.avg_score === 'number' ? c.avg_score.toFixed(1) : c.avg_score}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Distribuicao de Risco</div>
          {risk.length === 0 ? (
            <p style={{ color: '#999', fontSize: 14 }}>Nenhuma deteccao ainda</p>
          ) : (
            <div>
              {risk.map((r, i) => {
                const colors = { 'Baixo (1-3)': '#27ae60', 'Medio (4-6)': '#f39c12', 'Alto (7-8)': '#e67e22', 'Critico (9-10)': '#e74c3c' };
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div style={{ width: 120, fontSize: 13, fontWeight: 500 }}>{r.risk_level}</div>
                    <div style={{ flex: 1, height: 24, background: '#f0f0f0', borderRadius: 12, overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.min(100, (r.cnt / Math.max(...risk.map(x => x.cnt))) * 100)}%`,
                        height: '100%',
                        background: colors[r.risk_level] || '#999',
                        borderRadius: 12,
                      }}></div>
                    </div>
                    <div style={{ width: 40, textAlign: 'right', fontWeight: 600 }}>{r.cnt}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Videos Recentes</div>
        {recent.length === 0 ? (
          <div className="empty-state">
            <h3>Nenhum video processado ainda</h3>
            <p>Faca upload de um video ou inicie o processamento em batch</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('upload')}>
              Upload de Video
            </button>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Arquivo</th>
                <th>Status</th>
                <th>Duracao</th>
                <th>Risco</th>
                <th>Deteccoes</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((v, i) => (
                <tr key={i} className="clickable" onClick={() => navigate('review', { videoId: v.video_id })}>
                  <td style={{ fontWeight: 500 }}>{v.filename}</td>
                  <td><span className={`badge badge-${(v.status || 'pending').toLowerCase()}`}>{v.status}</span></td>
                  <td>{v.duration_seconds ? `${Math.round(v.duration_seconds)}s` : '-'}</td>
                  <td>
                    {v.overall_risk ? (
                      <span className={`score-gauge ${getScoreClass(v.overall_risk)}`}>
                        {typeof v.overall_risk === 'number' ? v.overall_risk.toFixed(1) : v.overall_risk}
                      </span>
                    ) : '-'}
                  </td>
                  <td>{v.total_detections || 0}</td>
                  <td style={{ fontSize: 12, color: '#999' }}>{formatDate(v.upload_timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function getScoreClass(score) {
  if (score <= 3) return 'score-low';
  if (score <= 6) return 'score-medium';
  if (score <= 8) return 'score-high';
  return 'score-critical';
}

function formatDate(ts) {
  if (!ts) return '-';
  try {
    return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return ts; }
}

export default Dashboard;
