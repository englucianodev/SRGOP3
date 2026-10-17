import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, LockKeyhole } from 'lucide-react';
import logo from '../assets/srgop.svg';
import { useApp } from '../context/AppContext';
import { useData } from '../hooks/useData';
import { api } from '../services/api';
import { Field } from '../components/UI';
export default function Login() {
  const { user, login, notify } = useApp(); const [register, setRegister] = useState(false); const [show, setShow] = useState(false); const [busy, setBusy] = useState(false);
  const { data: cities } = useData(register ? '/auth/cities' : null);
  const [form, setForm] = useState({ email: '', senha: '', confirmarSenha: '', nomeCompleto: '', cidade: '', tipoAcesso: 'Praça', lembrar: false });
  const change = event => setForm({ ...form, [event.target.name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });
  if (user) return <Navigate to="/dashboard" replace/>;
  async function submit(event) {
    event.preventDefault(); setBusy(true);
    try {
      if (register) { const result = await api('/auth/register', { method: 'POST', body: form }); notify(result.message, 'info'); setRegister(false); }
      else await login(form);
    } catch { /* Erro exibido pelo contexto. */ } finally { setBusy(false); }
  }
  return <main className="auth-page"><div className="auth-top"><span>POLÍCIA MILITAR DO MARANHÃO</span><span>18º BATALHÃO</span></div><section className="auth-card"><img src={logo} alt="Símbolo SRGOP" className="auth-logo"/><div className="auth-wordmark">SRGOP<span>18º BPM · MARANHÃO</span></div><h1>Sistema de Recebimento e Gerenciamento de Ocorrências Policiais</h1><div className="auth-divider"/><h2>{register ? 'Solicite seu acesso' : 'Bem-vindo ao SRGOP'}</h2><p>{register ? 'Preencha seus dados para análise do Administrativo.' : 'Entre com suas credenciais para acessar a central.'}</p><form onSubmit={submit} className="auth-form">
    {register && <Field label="Nome completo" name="nomeCompleto" autoComplete="name" value={form.nomeCompleto} onChange={change} required minLength={3}/>}
    <Field label="E-mail institucional" type="email" name="email" autoComplete="username" placeholder="seu.nome@exemplo.com" value={form.email} onChange={change} required/>
    <label className="field"><span>Senha *</span><span className="password-input"><input name="senha" type={show ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} placeholder="Digite sua senha" value={form.senha} onChange={change} required minLength={register ? 12 : undefined}/><button type="button" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShow(!show)}>{show ? <EyeOff size={19}/> : <Eye size={19}/>}</button></span></label>
    {register && <><Field label="Confirmar senha" name="confirmarSenha" type="password" autoComplete="new-password" value={form.confirmarSenha} onChange={change} required minLength={12}/><Field label="Cidade"><select name="cidade" value={form.cidade} onChange={change} required><option value="">Selecione a cidade</option>{cities.map(city => <option key={city._id} value={city._id}>{city.nome}</option>)}</select></Field><Field label="Tipo de acesso solicitado"><select name="tipoAcesso" value={form.tipoAcesso} onChange={change}>{['Praça', 'Oficial', 'Administrativo'].map(role => <option key={role}>{role}</option>)}</select></Field><small>O perfil e a ativação serão aprovados pelo Administrativo.</small></>}
    {!register && <div className="auth-options"><label className="check"><input type="checkbox" name="lembrar" checked={form.lembrar} onChange={change}/>Lembrar de mim</label><button type="button" className="text-button" onClick={() => notify('Solicite a redefinição da senha ao Administrativo. A recuperação por e-mail será disponibilizada futuramente.', 'info')}>Esqueci minha senha</button></div>}
    <button className="button primary auth-submit" disabled={busy}>{busy ? 'Aguarde…' : register ? 'Enviar cadastro' : 'Entrar no sistema'}<ArrowRight size={18}/></button>
  </form><p className="auth-switch">{register ? 'Já possui acesso?' : 'Ainda não possui acesso?'} <button className="text-button" onClick={() => setRegister(!register)}>{register ? 'Voltar ao login' : 'Criar cadastro'}</button></p><div className="auth-secure"><LockKeyhole size={14}/>Ambiente de acesso restrito e autenticado</div></section><footer className="auth-footer">SRGOP · Gestão integrada, resposta coordenada.<span>18º BPM — Polícia Militar do Maranhão</span></footer></main>;
}
