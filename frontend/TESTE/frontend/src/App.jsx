import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { Loading, Modal } from './components/UI';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Occurrences from './pages/Occurrences';
import Resources from './pages/Resources';
import Settings from './pages/Settings';
const OperationalMap = lazy(() => import('./pages/OperationalMap'));
const Reports = lazy(() => import('./pages/Reports'));
function Guard({ roles }) {
  const { user, loading } = useApp(); const location = useLocation();
  if (loading) return <Loading/>;
  if (!user) return <Navigate to="/login" replace/>;
  if (roles && !roles.includes(user.tipoAcesso)) return <Navigate to="/dashboard" replace/>;
  if (user.atendimentoAtivo && !['/dashboard', '/atendimento', '/ocorrencias', '/mapa'].includes(location.pathname)) return <Navigate to="/atendimento" replace/>;
  return <Outlet/>;
}
function Notice() {
  const { notice, setNotice } = useApp();
  if (!notice) return null;
  if (notice.type === 'error') return <Modal title="Não foi possível concluir a ação" onClose={notice.onClose || (() => setNotice(null))}><p role="alert">{notice.message}</p><div className="modal-actions"><button className="button primary" onClick={notice.onClose || (() => setNotice(null))}>Entendi · Continuar</button></div></Modal>;
  return <div role="status" className={`toast ${notice.type}`}><span>{notice.message}</span><button aria-label="Fechar aviso" onClick={() => setNotice(null)}>×</button></div>;
}
export default function App() {
  return <ErrorBoundary><BrowserRouter><AppProvider><Notice/><Suspense fallback={<Loading/>}><Routes><Route path="/login" element={<Login/>}/><Route element={<Guard/>}><Route element={<Layout/>}><Route path="/dashboard" element={<Dashboard/>}/><Route path="/ocorrencias" element={<Occurrences/>}/><Route path="/atendimento" element={<Occurrences mode="attendance"/>}/><Route path="/guarnicoes" element={<Resources kind="crews"/>}/><Route element={<Guard roles={['Administrativo', 'Oficial']}/>}><Route path="/despachos" element={<Occurrences mode="dispatch"/>}/><Route path="/viaturas" element={<Resources kind="vehicles"/>}/><Route path="/mapa" element={<OperationalMap/>}/><Route path="/relatorios" element={<Reports/>}/><Route path="/usuarios" element={<Resources kind="users"/>}/><Route path="/configuracoes" element={<Settings/>}/></Route><Route element={<Guard roles={['Administrativo']}/>}><Route path="/administrativo" element={<Settings admin/>}/></Route></Route></Route><Route path="*" element={<Navigate to="/dashboard" replace/>}/></Routes></Suspense></AppProvider></BrowserRouter></ErrorBoundary>;
}
