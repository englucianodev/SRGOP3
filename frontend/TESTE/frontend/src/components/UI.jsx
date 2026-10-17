import { useEffect, useRef } from 'react';
import { X, Inbox, LoaderCircle } from 'lucide-react';
export function Badge({ children }) { return <span className={`badge ${['Alta', 'Em manutenção', 'Indisponível', 'Cancelada'].includes(children) ? 'red' : ['Média', 'Despachada', 'Em aberto'].includes(children) ? 'amber' : ['Encerrada', 'Disponível', 'Ativo', 'Autorizado'].includes(children) ? 'green' : 'blue'}`}><i />{children}</span>; }
export function Empty({ title = 'Nenhum registro encontrado', text = 'Os registros aparecerão aqui assim que forem cadastrados.' }) { return <div className="empty"><Inbox size={34}/><h3>{title}</h3><p>{text}</p></div>; }
export function Loading() { return <div className="empty" role="status"><LoaderCircle className="spin"/>Carregando informações…</div>; }
export function PageTitle({ eyebrow = 'CENTRAL DE OPERAÇÕES', title, subtitle, children }) { return <div className="page-title"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div><div className="actions">{children}</div></div>; }
export function Modal({ title, children, onClose, wide = false }) {
  const dialog = useRef(null);
  useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={dialog} className={wide ? 'modal wide' : 'modal'} onCancel={event => { event.preventDefault(); onClose(); }} aria-label={title}><header><h2>{title}</h2><button className="icon-button" aria-label="Fechar" onClick={onClose}><X size={20}/></button></header>{children}</dialog>;
}
export function Field({ label, children, ...props }) { return <label className="field"><span>{label}{props.required && <b aria-hidden="true"> *</b>}</span>{children || <input {...props}/>}</label>; }
export function Confirm({ title, message, onClose, onConfirm, label = 'Confirmar' }) { return <Modal title={title} onClose={onClose}><p>{message}</p><div className="modal-actions"><button className="button" onClick={onClose}>Cancelar</button><button className="button danger" onClick={onConfirm}>{label}</button></div></Modal>; }
