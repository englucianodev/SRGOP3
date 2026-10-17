import { Component } from 'react';
export default class ErrorBoundary extends Component {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(error) { console.error('Interface React:', error); }
  render() { return this.state.error ? <main className="empty"><h1>Não foi possível exibir esta página.</h1><p>Origem: interface React. Retorne ao Dashboard para continuar.</p><a className="button primary" href="/dashboard">Voltar ao Dashboard</a></main> : this.props.children; }
}
