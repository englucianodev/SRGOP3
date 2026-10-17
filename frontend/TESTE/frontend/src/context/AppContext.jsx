import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { api } from '../services/api';
import { id } from '../utils/format';
const Context = createContext(null);
export const useApp = () => useContext(Context);
export function AppProvider({ children }) {
  const [user, setUser] = useState(null); const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({ inatividadeMinutos: 5, som: true });
  const [theme, setTheme] = useState(localStorage.getItem('srgop:theme') || 'light');
  const [sound, setSound] = useState(localStorage.getItem('srgop:sound') !== 'false');
  const [notice, setNotice] = useState(null); const [remaining, setRemaining] = useState(300);
  const [online, setOnline] = useState(false); const [alert, setAlert] = useState(null);
  const navigate = useNavigate(); const lastActivity = useRef(Date.now()); const lastSync = useRef(0); const audio = useRef(null); const noticeTimer = useRef(null);
  const notify = useCallback((message, type = 'success') => { clearTimeout(noticeTimer.current); setNotice({ message, type }); noticeTimer.current = setTimeout(() => setNotice(null), 6000); }, []);
  const refreshUser = useCallback(async () => { const data = await api('/auth/me'); setUser(data.user); }, []);
  const logout = useCallback(async (inactive = false) => {
    try { await api('/auth/logout', { method: 'POST', quiet: true }); } catch { /* A sessão local é encerrada mesmo offline. */ }
    setUser(null); setAlert(null); navigate('/login', { replace: true });
    notify(inactive ? 'Sessão encerrada por inatividade. Entre novamente.' : 'Você saiu do sistema.', 'info');
  }, [navigate, notify]);
  useEffect(() => { api('/auth/me', { quiet: true }).then(data => { setUser(data.user); lastActivity.current = new Date(data.ultimaAtividade).getTime(); }).catch(() => {}).finally(() => setLoading(false)); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('srgop:theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem('srgop:sound', String(sound)); }, [sound]);
  useEffect(() => {
    const listener = event => {
      const { message, origem, status } = event.detail;
      clearTimeout(noticeTimer.current);
      setNotice({ message: `${message} Origem: ${origem}.`, type: 'error', onClose: () => { setNotice(null); if (status === 401) { setUser(null); navigate('/login'); } else navigate('/dashboard'); } });
    };
    window.addEventListener('srgop:error', listener); return () => window.removeEventListener('srgop:error', listener);
  }, [navigate]);
  useEffect(() => { if (user?._id) api('/settings').then(value => setSettings(value || { inatividadeMinutos: 5, som: true })).catch(() => {}); }, [user?._id]);
  useEffect(() => {
    if (!user?._id) return;
    const activity = () => {
      lastActivity.current = Date.now();
      if (!audio.current && sound) { try { audio.current = new window.AudioContext(); } catch { /* Sem suporte a áudio. */ } }
      if (audio.current?.state === 'suspended') audio.current.resume().catch(() => {});
      if (Date.now() - lastSync.current > 15000) { lastSync.current = Date.now(); api('/auth/activity', { method: 'POST' }).catch(() => {}); }
    };
    const events = ['mousemove', 'click', 'keydown', 'touchstart', 'scroll'];
    events.forEach(event => window.addEventListener(event, activity, { passive: true }));
    const timer = setInterval(() => {
      const seconds = Math.max(0, Math.ceil((settings.inatividadeMinutos || 5) * 60 - (Date.now() - lastActivity.current) / 1000));
      setRemaining(seconds); if (!seconds) { clearInterval(timer); logout(true); }
    }, 1000);
    return () => { clearInterval(timer); events.forEach(event => window.removeEventListener(event, activity)); };
  }, [user?._id, settings.inatividadeMinutos, logout, sound]);
  useEffect(() => {
    if (!user?._id) return;
    const socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000', { withCredentials: true });
    const refresh = () => { window.dispatchEvent(new Event('srgop:refresh')); refreshUser().catch(() => {}); };
    socket.on('connect', () => { setOnline(true); refresh(); });
    socket.on('disconnect', () => setOnline(false));
    socket.on('connect_error', () => setOnline(false));
    socket.on('despacho', event => { refresh(); if (event.guarnicao === id(user.guarnicao)) { setAlert(event); navigate('/atendimento'); if ('Notification' in window && Notification.permission === 'granted' && localStorage.getItem('srgop:notifications') === 'granted') new Notification('SRGOP · Novo despacho', { body: 'Sua guarnição recebeu uma ocorrência. Acesse o atendimento.' }); } else notify(event.message, 'info'); });
    socket.on('atualizacao', () => { setAlert(null); refresh(); });
    socket.on('apoio', event => { notify(event.message, 'info'); refresh(); });
    return () => { socket.disconnect(); setOnline(false); };
  }, [user?._id, user?.guarnicao, navigate, notify, refreshUser]);
  useEffect(() => {
    if (!alert || !sound || !settings.som) return;
    const beep = () => { if (!audio.current || audio.current.state !== 'running') return; const oscillator = audio.current.createOscillator(); const gain = audio.current.createGain(); oscillator.frequency.value = 720; gain.gain.value = .06; oscillator.connect(gain); gain.connect(audio.current.destination); oscillator.start(); oscillator.stop(audio.current.currentTime + .25); };
    beep(); const timer = setInterval(beep, 1600); return () => clearInterval(timer);
  }, [alert, sound, settings.som]);
  const login = async data => { const result = await api('/auth/login', { method: 'POST', body: data }); lastActivity.current = Date.now(); setUser(result.user); navigate('/dashboard'); };
  const act = async (path, body = {}, method = 'POST') => { const result = await api(path, { method, body }); window.dispatchEvent(new Event('srgop:refresh')); await refreshUser(); notify(result.message || 'Operação concluída.'); return result; };
  return <Context.Provider value={{ user, loading, login, logout, refreshUser, settings, setSettings, theme, setTheme, sound, setSound, notice, setNotice, notify, remaining, online, alert, setAlert, act }}>{children}</Context.Provider>;
}
