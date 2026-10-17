export const API = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/$/, '');
export async function api(path, options = {}) {
  const { quiet = false, ...rest } = options;
  try {
    const form = rest.body instanceof FormData;
    const response = await fetch(`${API}${path}`, { ...rest, credentials: 'include', headers: { ...(!form ? { 'Content-Type': 'application/json' } : {}), 'X-SRGOP-Client': 'web', ...rest.headers }, ...(rest.body && !form ? { body: JSON.stringify(rest.body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.message || 'Falha na operação.'), { origem: data.origem || path, status: response.status });
    return data;
  } catch (error) {
    if (!quiet) window.dispatchEvent(new CustomEvent('srgop:error', { detail: { message: error.message === 'Failed to fetch' ? 'Não foi possível conectar ao servidor. Verifique a conexão.' : error.message, origem: error.origem || `API ${path}`, status: error.status } }));
    throw error;
  }
}
export const queryString = object => new URLSearchParams(Object.entries(object).filter(([, v]) => v !== '' && v !== undefined)).toString();
