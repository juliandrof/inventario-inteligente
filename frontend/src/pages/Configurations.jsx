import React, { useState, useEffect } from 'react';
import { fetchContexts, createContext, updateContext, deleteContext } from '../api';

function Configurations() {
  const [contexts, setContexts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(newForm());
  const [toast, setToast] = useState('');

  function newForm() {
    return { name: '', description: '', categories: ['fadiga', 'distracao'], scan_prompt: '', scan_fps: 0.2, detail_fps: 1.0, score_threshold: 4, newCat: '' };
  }

  const load = () => { fetchContexts().then(setContexts).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(load, []);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const handleEdit = (ctx) => {
    let cats = ctx.categories;
    if (typeof cats === 'string') try { cats = JSON.parse(cats); } catch { cats = []; }
    setEditing(ctx.context_id);
    setForm({ ...ctx, categories: cats, newCat: '' });
  };

  const handleSave = async () => {
    const data = {
      name: form.name, description: form.description,
      categories: form.categories, scan_prompt: form.scan_prompt,
      scan_fps: parseFloat(form.scan_fps), detail_fps: parseFloat(form.detail_fps),
      score_threshold: parseInt(form.score_threshold),
    };
    if (editing === 'new') { await createContext(data); showToast('Contexto criado!'); }
    else { await updateContext(editing, data); showToast('Contexto atualizado!'); }
    setEditing(null); load();
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Excluir o contexto "${name}"?`)) return;
    await deleteContext(id); showToast('Contexto excluido!'); load();
  };

  const addCat = () => {
    const c = form.newCat.trim().toLowerCase();
    if (c && !form.categories.includes(c)) setForm({ ...form, categories: [...form.categories, c], newCat: '' });
  };

  if (loading) return <div className="loading"><div className="spinner"></div>Carregando...</div>;

  if (editing) {
    return (
      <div>
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>{editing === 'new' ? 'Novo Contexto' : `Editar: ${form.name}`}</h1>
          <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancelar</button>
        </div>
        <div className="card">
          <div className="form-group"><label>Nome do Contexto</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex: Motorista, Seguranca do Trabalho" /></div>
          <div className="form-group"><label>Descricao</label>
            <input type="text" value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Breve descricao" /></div>
        </div>
        <div className="card">
          <div className="card-title">Categorias de Deteccao</div>
          <p style={{ fontSize: 13, color: '#999', marginBottom: 12 }}>Cada categoria recebe score 0-10.</p>
          <div className="category-tags">
            {form.categories.map((cat, i) => (
              <div key={i} className="category-tag"><span style={{ textTransform: 'capitalize' }}>{cat}</span>
                <span className="tag-remove" onClick={() => setForm({ ...form, categories: form.categories.filter(c => c !== cat) })}>x</span></div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input type="text" value={form.newCat} onChange={e => setForm({ ...form, newCat: e.target.value })}
              placeholder="Nova categoria" onKeyDown={e => e.key === 'Enter' && addCat()}
              style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }} />
            <button className="btn btn-primary btn-sm" onClick={addCat}>Adicionar</button>
          </div>
        </div>
        <div className="card">
          <div className="card-title">Prompt de Analise</div>
          <p style={{ fontSize: 13, color: '#999', marginBottom: 8 }}>Texto enviado ao modelo de IA junto com cada frame.</p>
          <div className="form-group">
            <textarea value={form.scan_prompt} onChange={e => setForm({ ...form, scan_prompt: e.target.value })}
              style={{ minHeight: 120, fontFamily: 'monospace', fontSize: 13 }}
              placeholder="Descreva o que o modelo deve analisar..." />
          </div>
        </div>
        <div className="card">
          <div className="card-title">Parametros</div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ width: 150 }}><label>FPS Scan</label>
              <input type="number" step="0.1" min="0.1" max="5" value={form.scan_fps} onChange={e => setForm({ ...form, scan_fps: e.target.value })} /></div>
            <div className="form-group" style={{ width: 150 }}><label>FPS Detalhe</label>
              <input type="number" step="0.1" min="0.1" max="10" value={form.detail_fps} onChange={e => setForm({ ...form, detail_fps: e.target.value })} /></div>
            <div className="form-group" style={{ width: 150 }}><label>Threshold (1-10)</label>
              <input type="number" min="1" max="10" value={form.score_threshold} onChange={e => setForm({ ...form, score_threshold: e.target.value })} /></div>
          </div>
        </div>
        <button className="btn btn-primary" onClick={handleSave}
          disabled={!form.name.trim() || !form.scan_prompt.trim() || form.categories.length === 0}>
          {editing === 'new' ? 'Criar Contexto' : 'Salvar Alteracoes'}
        </button>
        {toast && <div className="toast toast-success">{toast}</div>}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><h1>Contextos de Analise</h1><p>Perfis de configuracao para diferentes tipos de analise</p></div>
        <button className="btn btn-primary" onClick={() => { setEditing('new'); setForm(newForm()); }}>Novo Contexto</button>
      </div>
      {contexts.length === 0 ? (
        <div className="empty-state"><h3>Nenhum contexto</h3><p>Crie um contexto para comecar</p></div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {contexts.map(ctx => {
            let cats = ctx.categories;
            if (typeof cats === 'string') try { cats = JSON.parse(cats); } catch { cats = []; }
            return (
              <div key={ctx.context_id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex' }}>
                  <div style={{ width: 6, background: 'var(--dbxsc-primary)', flexShrink: 0 }} />
                  <div style={{ flex: 1, padding: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <h3 style={{ fontSize: 16, marginBottom: 4 }}>{ctx.name}</h3>
                        {ctx.description && <p style={{ fontSize: 13, color: '#999', marginBottom: 8 }}>{ctx.description}</p>}
                        <div className="category-tags" style={{ marginBottom: 8 }}>
                          {cats.map((c, i) => <span key={i} className="category-tag" style={{ textTransform: 'capitalize', fontSize: 12 }}>{c}</span>)}
                        </div>
                        <div style={{ fontSize: 12, color: '#999' }}>FPS: {ctx.scan_fps} | Threshold: {ctx.score_threshold}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => handleEdit(ctx)}>Editar</button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleDelete(ctx.context_id, ctx.name)}>Excluir</button>
                      </div>
                    </div>
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ fontSize: 12, color: '#666', cursor: 'pointer' }}>Ver prompt</summary>
                      <pre style={{ fontSize: 11, color: '#555', marginTop: 8, whiteSpace: 'pre-wrap', background: '#f9f9f9', padding: 10, borderRadius: 6 }}>{ctx.scan_prompt}</pre>
                    </details>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {toast && <div className="toast toast-success">{toast}</div>}
    </div>
  );
}

export default Configurations;
