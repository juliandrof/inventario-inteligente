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

// Dashboard
export const fetchDashboardSummary = () => request('/dashboard/summary');
export const fetchDashboardByCategory = () => request('/dashboard/by-category');
export const fetchDashboardRecent = () => request('/dashboard/recent');
export const fetchRiskDistribution = () => request('/dashboard/risk-distribution');

// Videos
export const fetchVideos = () => request('/videos');
export const fetchVideo = (id) => request(`/videos/${id}`);
export const deleteVideo = (id) => request(`/videos/${id}`, { method: 'DELETE' });
export const uploadVideo = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/videos/upload`, { method: 'POST', body: formData });
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
export const fetchPendingVideos = () => request('/review/pending-videos');
export const fetchReviewLog = () => request('/review/log');

// Batch
export const startBatch = (volumePath) => request('/batch/start', {
  method: 'POST', body: JSON.stringify({ volume_path: volumePath }),
});
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

// Catalog Browser
export const fetchCatalogs = () => request('/catalog/catalogs');
export const fetchSchemas = (catalog) => request(`/catalog/schemas/${catalog}`);
export const fetchVolumes = (catalog, schema) => request(`/catalog/volumes/${catalog}/${schema}`);
export const fetchFiles = (path) => request(`/catalog/files?path=${encodeURIComponent(path)}`);
