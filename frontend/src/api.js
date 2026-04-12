const BASE_URL = '/api';

async function request(url, options = {}) {
  const res = await fetch(`${BASE_URL}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Dashboard (with optional filters)
function qs(params) {
  const s = Object.entries(params).filter(([,v]) => v != null && v !== '').map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return s ? '?' + s : '';
}
export const fetchDashboardSummary = (f={}) => request('/dashboard/summary' + qs(f));
export const fetchDashboardByCategory = (f={}) => request('/dashboard/by-category' + qs(f));
export const fetchDashboardRecent = (f={}) => request('/dashboard/recent' + qs(f));
export const fetchRiskDistribution = (f={}) => request('/dashboard/risk-distribution' + qs(f));

// Videos
export const fetchVideos = () => request('/videos');
export const fetchVideo = (id) => request(`/videos/${id}`);
export const deleteVideo = (id) => request(`/videos/${id}`, { method: 'DELETE' });
export const uploadVideo = async (file, contextId) => {
  const formData = new FormData();
  formData.append('file', file);
  const url = contextId ? `${BASE_URL}/videos/upload?context_id=${contextId}` : `${BASE_URL}/videos/upload`;
  const res = await fetch(url, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

// Analysis
export const fetchAnalysis = (videoId) => request(`/analysis/${videoId}`);
export const fetchDetections = (videoId) => request(`/analysis/${videoId}/detections`);

// Review
export const confirmDetection = (id, notes) => request(`/review/${id}/confirm`, {
  method: 'POST', body: JSON.stringify({ notes }),
});
export const rejectDetection = (id, notes) => request(`/review/${id}/reject`, {
  method: 'POST', body: JSON.stringify({ notes }),
});
export const fetchPendingReviews = () => request('/review/pending');
export const fetchPendingVideos = (f={}) => request('/review/pending-videos' + qs(f));
export const fetchReviewLog = () => request('/review/log');

// Batch
export const startBatch = (volumePath, contextId) => request('/batch/start', {
  method: 'POST', body: JSON.stringify({ volume_path: volumePath, context_id: contextId || 0 }),
});

// Contexts
export const fetchContexts = () => request('/contexts');
export const createContext = (data) => request('/contexts', { method: 'POST', body: JSON.stringify(data) });
export const updateContext = (id, data) => request(`/contexts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteContext = (id) => request(`/contexts/${id}`, { method: 'DELETE' });
export const cancelBatch = (id) => request(`/batch/${id}/cancel`, { method: 'POST' });
export const fetchBatches = () => request('/batch');

// Configurations
export const fetchConfigs = () => request('/config');
export const fetchCategories = () => request('/config/categories');
export const updateConfig = (key, value, description) => request(`/config/${key}`, {
  method: 'PUT', body: JSON.stringify({ value, description }),
});

// Branding
export const fetchBranding = () => request('/branding');
export const updateBranding = (key, value) => request(`/branding/${key}`, {
  method: 'PUT', body: JSON.stringify({ value }),
});
export const uploadLogo = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/branding/logo`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

// Reports (paginated)
export const fetchReportVideos = (params = {}) => {
  const qs = Object.entries(params).filter(([,v]) => v != null && v !== '').map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return request(`/reports/videos${qs ? '?' + qs : ''}`);
};

// Streaming
export const startStream = (name, streamUrl, contextId, windowSec = 60, username = '', password = '') => request('/stream/start', {
  method: 'POST', body: JSON.stringify({ name, stream_url: streamUrl, context_id: contextId, window_seconds: windowSec, username, password }),
});
export const stopStream = (id) => request(`/stream/${id}/stop`, { method: 'POST' });
export const restartStream = (id) => request(`/stream/${id}/restart`, { method: 'POST' });
export const updateStream = (id, data) => request(`/stream/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteStream = (id) => request(`/stream/${id}`, { method: 'DELETE' });
export const fetchStreamLogs = (id) => request(`/stream/${id}/logs`);
export const fetchStreams = () => request('/stream');

// Catalog Browser
export const fetchCatalogs = () => request('/catalog/catalogs');
export const fetchSchemas = (catalog) => request(`/catalog/schemas/${catalog}`);
export const fetchVolumes = (catalog, schema) => request(`/catalog/volumes/${catalog}/${schema}`);
export const fetchFiles = (path) => request(`/catalog/files?path=${encodeURIComponent(path)}`);
