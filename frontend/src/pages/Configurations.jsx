import React, { useState, useEffect } from 'react';
import { fetchConfigs, updateConfig, fetchCategories } from '../api';

function Configurations() {
  const [configs, setConfigs] = useState([]);
  const [categories, setCategories] = useState([]);
  const [newCategory, setNewCategory] = useState('');
  const [editing, setEditing] = useState({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  const loadData = () => {
    setLoading(true);
    Promise.all([
      fetchConfigs().catch(() => []),
      fetchCategories().catch(() => []),
    ]).then(([c, cats]) => {
      setConfigs(c || []);
      setCategories(cats || []);
      setLoading(false);
    });
  };

  useEffect(() => { loadData(); }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleSave = async (key, value, desc) => {
    await updateConfig(key, value, desc);
    showToast(`Configuracao "${key}" atualizada!`);
    setEditing({});
    loadData();
  };

  const handleAddCategory = async () => {
    if (!newCategory.trim()) return;
    const updated = [...categories, newCategory.trim().toLowerCase()];
    await updateConfig('detection_categories', JSON.stringify(updated), 'Categorias de deteccao');
    setNewCategory('');
    showToast('Categoria adicionada!');
    loadData();
  };

  const handleRemoveCategory = async (cat) => {
    const updated = categories.filter(c => c !== cat);
    await updateConfig('detection_categories', JSON.stringify(updated), 'Categorias de deteccao');
    showToast('Categoria removida!');
    loadData();
  };

  if (loading) return <div className="loading"><div className="spinner"></div>Carregando configuracoes...</div>;

  const promptConfigs = configs.filter(c => c.config_key.includes('prompt'));
  const numericConfigs = configs.filter(c => !c.config_key.includes('prompt') && c.config_key !== 'detection_categories');

  return (
    <div>
      <div className="page-header">
        <h1>Configuracoes de Deteccao</h1>
        <p>Personalize o que o sistema deve buscar nos videos</p>
      </div>

      {/* Categories */}
      <div className="card">
        <div className="card-title">Categorias de Deteccao</div>
        <p style={{ fontSize: 13, color: '#999', marginBottom: 12 }}>
          Defina quais categorias o modelo deve analisar. Cada categoria recebera um score de 1 a 10.
        </p>
        <div className="category-tags">
          {categories.map((cat, i) => (
            <div key={i} className="category-tag">
              <span style={{ textTransform: 'capitalize' }}>{cat}</span>
              <span className="tag-remove" onClick={() => handleRemoveCategory(cat)}>x</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="Nova categoria (ex: uso_celular)"
            style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
          />
          <button className="btn btn-primary btn-sm" onClick={handleAddCategory}>Adicionar</button>
        </div>
      </div>

      {/* Prompts */}
      <div className="card">
        <div className="card-title">Prompts de Analise</div>
        <p style={{ fontSize: 13, color: '#999', marginBottom: 16 }}>
          Customize os prompts enviados ao modelo de visao. Isso define o que sera analisado em cada frame.
        </p>
        {promptConfigs.map((c, i) => (
          <div key={i} className="config-item" style={{ boxShadow: 'none', border: '1px solid #eee' }}>
            <div className="config-header">
              <div>
                <div className="config-key">{c.config_key}</div>
                {c.description && <div className="config-desc">{c.description}</div>}
              </div>
              {!editing[c.config_key] ? (
                <button className="btn btn-sm btn-secondary" onClick={() => setEditing({ ...editing, [c.config_key]: c.config_value })}>
                  Editar
                </button>
              ) : (
                <button className="btn btn-sm btn-primary" onClick={() => handleSave(c.config_key, editing[c.config_key], c.description)}>
                  Salvar
                </button>
              )}
            </div>
            {editing[c.config_key] !== undefined ? (
              <textarea
                value={editing[c.config_key]}
                onChange={(e) => setEditing({ ...editing, [c.config_key]: e.target.value })}
                style={{ width: '100%', minHeight: 100, marginTop: 12, padding: 12, border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'monospace' }}
              />
            ) : (
              <pre style={{ fontSize: 12, color: '#555', marginTop: 8, whiteSpace: 'pre-wrap', background: '#f9f9f9', padding: 12, borderRadius: 8 }}>
                {c.config_value}
              </pre>
            )}
          </div>
        ))}
      </div>

      {/* Numeric Settings */}
      <div className="card">
        <div className="card-title">Parametros de Analise</div>
        {numericConfigs.map((c, i) => (
          <div key={i} className="config-item" style={{ boxShadow: 'none', border: '1px solid #eee' }}>
            <div className="config-header">
              <div>
                <div className="config-key">{c.config_key}</div>
                {c.description && <div className="config-desc">{c.description}</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {editing[c.config_key] !== undefined ? (
                  <>
                    <input
                      type="text"
                      value={editing[c.config_key]}
                      onChange={(e) => setEditing({ ...editing, [c.config_key]: e.target.value })}
                      style={{ width: 120, padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }}
                    />
                    <button className="btn btn-sm btn-primary" onClick={() => handleSave(c.config_key, editing[c.config_key], c.description)}>
                      Salvar
                    </button>
                  </>
                ) : (
                  <>
                    <code style={{ background: '#f0f0f0', padding: '4px 10px', borderRadius: 6, fontSize: 13 }}>{c.config_value}</code>
                    <button className="btn btn-sm btn-secondary" onClick={() => setEditing({ ...editing, [c.config_key]: c.config_value })}>
                      Editar
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {toast && <div className="toast toast-success">{toast}</div>}
    </div>
  );
}

export default Configurations;
