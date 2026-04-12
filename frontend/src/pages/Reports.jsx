import React, { useState, useEffect, useCallback } from 'react';
import { fetchReportVideos, fetchDetections, fetchContexts } from '../api';

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function Reports({ navigate }) {
  const [data, setData] = useState({ items: [], total: 0, page: 1, total_pages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('ALL');
  const [contextFilter, setContextFilter] = useState('');
  const [contexts, setContexts] = useState([]);
  const [datePeriod, setDatePeriod] = useState('ALL');
  const [uploadFrom, setUploadFrom] = useState('');
  const [uploadTo, setUploadTo] = useState('');
  const [page, setPage] = useState(1);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [detections, setDetections] = useState([]);

  useEffect(() => { fetchContexts().then(setContexts).catch(() => {}); }, []);

  const resolvedFrom = datePeriod === 'CUSTOM' ? uploadFrom : datePeriod === '30' ? daysAgo(30) : datePeriod === '60' ? daysAgo(60) : datePeriod === '90' ? daysAgo(90) : '';
  const resolvedTo = datePeriod === 'CUSTOM' ? uploadTo : '';

  const loadData = useCallback((p = page) => {
    setLoading(true);
    const params = { page: p, per_page: 20 };
    if (search) params.search = search;
    if (riskFilter !== 'ALL') params.risk_filter = riskFilter;
    if (contextFilter) params.context_name = contextFilter;
    if (resolvedFrom) params.upload_from = resolvedFrom;
    if (resolvedTo) params.upload_to = resolvedTo;

    fetchReportVideos(params)
      .then(d => { setData(d); setPage(d.page); })
      .catch(() => setData({ items: [], total: 0, page: 1, total_pages: 1 }))
      .finally(() => setLoading(false));
  }, [search, riskFilter, contextFilter, resolvedFrom, resolvedTo, page]);

  useEffect(() => { loadData(1); }, [search, riskFilter, contextFilter, datePeriod, uploadFrom, uploadTo]);

  const handlePage = (p) => { setPage(p); loadData(p); };

  const handleSelect = async (video) => {
    setSelectedVideo(video);
    try { setDetections(await fetchDetections(video.video_id)); } catch { setDetections([]); }
  };

  // ==================== VIDEO DETAIL ====================
  if (selectedVideo) {
    const reviewed = detections.filter(d => d.review_status === 'CONFIRMED' || d.review_status === 'REJECTED');
    const pending = detections.filter(d => d.review_status === 'PENDING');

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18 }}>{selectedVideo.filename}</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-primary" onClick={() => navigate('review', { videoId: selectedVideo.video_id })}>
              Retornar para Analise
            </button>
            <button className="btn btn-sm btn-secondary" onClick={() => { setSelectedVideo(null); setDetections([]); }}>
              Voltar ao Relatorio
            </button>
          </div>
        </div>

        <div className="card">
          <video controls src={`/api/videos/${selectedVideo.video_id}/stream`}
            style={{ width: '100%', maxHeight: 400, borderRadius: 8, background: '#000' }} />
        </div>

        {selectedVideo.scores_json && (
          <div className="stat-cards">
            {(() => {
              try {
                return Object.entries(JSON.parse(selectedVideo.scores_json)).map(([cat, score]) => (
                  <div key={cat} className={`stat-card ${score >= 7 ? 'danger' : score >= 4 ? 'warning' : 'success'}`}>
                    <div className="stat-value">{score}</div>
                    <div className="stat-label" style={{ textTransform: 'capitalize' }}>{cat}</div>
                  </div>
                ));
              } catch { return null; }
            })()}
            <div className={`stat-card ${(selectedVideo.overall_risk || 0) >= 7 ? 'danger' : ''}`}>
              <div className="stat-value">{typeof selectedVideo.overall_risk === 'number' ? selectedVideo.overall_risk.toFixed(1) : selectedVideo.overall_risk || 0}</div>
              <div className="stat-label">Score Geral</div>
            </div>
          </div>
        )}

        {reviewed.length > 0 && (
          <div className="card">
            <div className="card-title">Deteccoes Revisadas ({reviewed.length})</div>
            <table className="data-table">
              <thead>
                <tr><th>Momento</th><th>Categoria</th><th>Score</th><th>Resultado</th><th>Descricao IA</th><th>Notas</th></tr>
              </thead>
              <tbody>
                {reviewed.map((d, i) => (
                  <tr key={i}>
                    <td>{fmtTime(d.timestamp_sec)}</td>
                    <td style={{ textTransform: 'capitalize' }}>{d.category}</td>
                    <td><span className={`score-gauge ${scoreClass(d.score)}`}>{d.score}</span></td>
                    <td><span className={`badge badge-${d.review_status.toLowerCase()}`}>{d.review_status === 'CONFIRMED' ? 'Confirmado' : 'Rejeitado'}</span></td>
                    <td style={{ fontSize: 12, maxWidth: 300 }}>{d.ai_description}</td>
                    <td style={{ fontSize: 12, fontStyle: 'italic' }}>{d.reviewer_notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pending.length > 0 && (
          <div className="card" style={{ borderLeft: '4px solid #f39c12' }}>
            <div className="card-title" style={{ color: '#856404' }}>Aguardando Revisao ({pending.length})</div>
            <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>Clique abaixo para revisar.</p>
            <button className="btn btn-sm btn-primary" onClick={() => navigate('review', { videoId: selectedVideo.video_id })}>Revisar Agora</button>
          </div>
        )}

        {detections.length === 0 && (
          <div className="card"><p style={{ color: '#999' }}>Nenhuma deteccao neste video (score 0).</p></div>
        )}
      </div>
    );
  }

  // ==================== VIDEO LIST ====================
  return (
    <div>
      <div className="page-header">
        <h1>Relatorio de Videos</h1>
        <p>{data.total} video(s) processado(s)</p>
      </div>

      {/* Filters */}
      <div className="card">
        {/* Search + score filter */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <input type="text" placeholder="Pesquisar por nome..." value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 180, padding: '9px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }} />
          {[['ALL','Todos'],['WITH_DETECTIONS','Com Deteccoes'],['CLEAN','Limpos'],['HIGH_RISK','Alto Score']].map(([k,l]) => (
            <button key={k} className={`btn btn-sm ${riskFilter === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setRiskFilter(k)}>{l}</button>
          ))}
        </div>

        {/* Context + Period filters */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {contexts.length > 0 && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Contexto</label>
              <select value={contextFilter} onChange={e => setContextFilter(e.target.value)}
                style={{ padding: '7px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, minWidth: 180 }}>
                <option value="">Todos</option>
                {contexts.map(c => <option key={c.context_id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Periodo</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['ALL','Todos'],['30','30 dias'],['60','60 dias'],['90','90 dias'],['CUSTOM','Personalizar']].map(([k,l]) => (
                <button key={k} className={`btn btn-sm ${datePeriod === k ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => { setDatePeriod(k); if (k !== 'CUSTOM') { setUploadFrom(''); setUploadTo(''); } }}>{l}</button>
              ))}
            </div>
          </div>

          {datePeriod === 'CUSTOM' && (
            <>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>De</label>
                <input type="date" value={uploadFrom} onChange={e => setUploadFrom(e.target.value)}
                  style={{ padding: '7px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Ate</label>
                <input type="date" value={uploadTo} onChange={e => setUploadTo(e.target.value)}
                  style={{ padding: '7px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="loading"><div className="spinner"></div>Carregando...</div>
      ) : data.items.length === 0 ? (
        <div className="empty-state">
          <h3>Nenhum video encontrado</h3>
          <p>{search ? 'Tente outro termo de busca' : 'Nenhum video processado ainda'}</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="data-table">
              <thead>
                <tr><th>Arquivo</th><th>Contexto</th><th>Duracao</th><th>Score</th><th>Deteccoes</th><th>Categorias</th><th>Upload</th><th>Acoes</th></tr>
              </thead>
              <tbody>
                {data.items.map((v, i) => (
                  <tr key={i} className="clickable" onClick={() => handleSelect(v)}>
                    <td style={{ fontWeight: 500 }}>{v.filename}</td>
                    <td>{v.context_name ? <span className="badge badge-analyzing">{v.context_name}</span> : <span style={{color:'#999'}}>-</span>}</td>
                    <td>{v.duration_seconds ? `${Math.round(v.duration_seconds)}s` : '-'}</td>
                    <td>
                      {v.overall_risk != null ? (
                        <span className={`score-gauge ${scoreClass(v.overall_risk)}`}>
                          {typeof v.overall_risk === 'number' ? v.overall_risk.toFixed(1) : v.overall_risk}
                        </span>
                      ) : '-'}
                    </td>
                    <td>{v.total_detections || 0}</td>
                    <td style={{ fontSize: 11 }}>
                      {(() => { try { return Object.entries(JSON.parse(v.scores_json)).map(([k,val]) => `${k}:${val}`).join(' | '); } catch { return '-'; } })()}
                    </td>
                    <td style={{ fontSize: 12, color: '#999' }}>{fmtDate(v.upload_timestamp)}</td>
                    <td>
                      <button className="btn btn-sm btn-primary" onClick={e => { e.stopPropagation(); navigate('review', { videoId: v.video_id }); }}>
                        Reanalisar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data.total_pages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
              <button className="btn btn-sm btn-secondary" disabled={page <= 1} onClick={() => handlePage(page - 1)}>Anterior</button>
              {Array.from({ length: Math.min(data.total_pages, 10) }, (_, i) => {
                const p = i + 1;
                return <button key={p} className={`btn btn-sm ${page === p ? 'btn-primary' : 'btn-secondary'}`} onClick={() => handlePage(p)}>{p}</button>;
              })}
              {data.total_pages > 10 && <span style={{ color: '#999' }}>...</span>}
              <button className="btn btn-sm btn-secondary" disabled={page >= data.total_pages} onClick={() => handlePage(page + 1)}>Proximo</button>
              <span style={{ fontSize: 12, color: '#999', marginLeft: 8 }}>Pagina {page} de {data.total_pages} ({data.total} videos)</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function scoreClass(s) { return s <= 3 ? 'score-low' : s <= 6 ? 'score-medium' : s <= 8 ? 'score-high' : 'score-critical'; }
function fmtTime(sec) { if (!sec && sec !== 0) return '-'; return `${Math.floor(sec/60)}:${String(Math.round(sec%60)).padStart(2,'0')}`; }
function fmtDate(ts) { if (!ts) return '-'; try { return new Date(ts).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }); } catch { return ts; } }

export default Reports;
