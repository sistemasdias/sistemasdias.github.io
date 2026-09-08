// config.js — PRODUÇÃO
// Usar var para permitir que outras páginas referenciem sem conflito de redeclaração
var SB_URL = 'https://nathaeuqbeqlvkftbmes.supabase.co';
var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5hdGhhZXVxYmVxbHZrZnRibWVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4OTc4MzYsImV4cCI6MjA5NTQ3MzgzNn0.9t3q5C_h1pRb11gqRtpGGVpOUGey5TBzvMgal8h6wtg';

var CLINICA_CONFIG = {
  nome: 'Dra. Anna Carolina Dias',
  especialidade: 'Harmonização Orofacial',
  logo: 'logo.jpg',
  cor: '#1D9E75',
  pinLength: 4,
  loginEmail: 'clinica@annacarolina.com',
  registro: 'CRO 82281'
};

// ── Renovação automática do token ──
function _prazoRealToken(accessToken) {
  // Decodifica o JWT em si (campo "exp") — é o prazo real que o Supabase usa
  // para aceitar ou recusar o token, independente do prazo "de exibição" da sessão.
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    return payload.exp * 1000; // exp vem em segundos
  } catch(e) {
    return 0; // se não conseguir decodificar, força renovação por segurança
  }
}

async function renovarTokenSeNecessario() {
  try {
    const auth = JSON.parse(localStorage.getItem('clinica_auth') || '{}');
    if (!auth.ok || !auth.refresh_token || !auth.access_token) return false;
    const expiraEm = _prazoRealToken(auth.access_token);
    const faltam = expiraEm - Date.now();
    if (faltam < 20 * 60 * 1000) { // Renova se faltam menos de 20 min para o TOKEN REAL expirar
      const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY },
        body: JSON.stringify({ refresh_token: auth.refresh_token })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        localStorage.removeItem('clinica_auth');
        sessionStorage.removeItem('clinica_auth');
        window.location.href = 'login.html';
        return false;
      }
      const novaAuth = {
        ok: true,
        expires: Date.now() + 24 * 60 * 60 * 1000,
        access_token: data.access_token,
        refresh_token: data.refresh_token || auth.refresh_token
      };
      localStorage.setItem('clinica_auth', JSON.stringify(novaAuth));
      sessionStorage.setItem('clinica_auth', '1');
      return true;
    }
    return true;
  } catch(e) { return false; }
}

// Renova ao carregar e a cada 10 minutos — intervalo menor que o prazo real do
// token (padrão de 1h no Supabase), garantindo que sempre haja tempo de renovar
// antes de expirar de verdade, mesmo em atendimentos longos.
(async () => {
  const auth = JSON.parse(localStorage.getItem('clinica_auth') || '{}');
  if (auth.ok) await renovarTokenSeNecessario();
  setInterval(renovarTokenSeNecessario, 10 * 60 * 1000);
})();

// Renova também assim que a aba volta a ficar visível — cobre o caso do
// tablet/computador hibernar durante um atendimento longo, quando o
// navegador pode pausar o setInterval sozinho enquanto está em segundo plano.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') renovarTokenSeNecessario();
});

// ── Rascunho automático de formulários ──
// Protege contra perda de digitação (sessão caiu, internet oscilou, aba fechou
// sem querer): salva os campos no navegador enquanto a pessoa digita, e
// recupera automaticamente se o formulário for reaberto antes de salvar de verdade.
const _RASCUNHO_TIMER = {};
const _RASCUNHO_UNLOAD_WIRED = new Set();

function rascunhoAtivar(chave, camposIds) {
  const KEY = 'rascunho_' + chave;
  function salvarAgora() {
    const dados = {};
    camposIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) dados[id] = el.value;
    });
    const temConteudo = Object.values(dados).some(v => v && String(v).trim() !== '');
    if (temConteudo) localStorage.setItem(KEY, JSON.stringify({ dados, quando: Date.now() }));
    else localStorage.removeItem(KEY);
  }
  camposIds.forEach(id => {
    const el = document.getElementById(id);
    // Compara pela chave específica (não só "já tem algum"), para permitir
    // reativar corretamente quando o mesmo campo é reusado em outro contexto
    // (ex: o mesmo campo de recado, para "novo lembrete" e "editar lembrete").
    if (!el || el.dataset.rascunhoChave === chave) return;
    el.dataset.rascunhoChave = chave;
    el.addEventListener('input', () => {
      clearTimeout(_RASCUNHO_TIMER[chave]);
      _RASCUNHO_TIMER[chave] = setTimeout(salvarAgora, 800);
    });
  });
  // Salva na hora se a aba for fechada, recarregada, ou perder o foco —
  // não depende de esperar a pausa de digitação. Cobre quedas inesperadas
  // e também recargas rápidas (ex: F5 logo depois de digitar).
  if (!_RASCUNHO_UNLOAD_WIRED.has(chave)) {
    _RASCUNHO_UNLOAD_WIRED.add(chave);
    const salvarImediato = () => { clearTimeout(_RASCUNHO_TIMER[chave]); salvarAgora(); };
    window.addEventListener('beforeunload', salvarImediato);
    window.addEventListener('pagehide', salvarImediato);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') salvarImediato();
    });
  }
}

function rascunhoChecar(chave, camposIds) {
  const KEY = 'rascunho_' + chave;
  try {
    const salvo = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!salvo || !salvo.dados) return null;
    camposIds.forEach(id => {
      const el = document.getElementById(id);
      if (el && salvo.dados[id] != null) el.value = salvo.dados[id];
    });
    return salvo.quando;
  } catch (e) { return null; }
}

function rascunhoLimpar(chave) {
  localStorage.removeItem('rascunho_' + chave);
}

function rascunhoFormatarHora(timestamp) {
  return new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Variante para formulários com listas dinâmicas (itens que se adicionam/removem,
// como orçamentos e atendimentos com múltiplos tratamentos). Em vez de uma lista
// fixa de IDs de campo, recebe uma função "coletar" que devolve os dados atuais
// já estruturados (o formulário decide como ler seu próprio estado).
function rascunhoDinamicoSalvar(chave, coletar) {
  try {
    const dados = coletar();
    const KEY = 'rascunho_' + chave;
    const vazio = !dados || (Array.isArray(dados) ? dados.length === 0 :
      Object.values(dados).every(v => !v || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && v.trim() === '')));
    if (!vazio) localStorage.setItem(KEY, JSON.stringify({ dados, quando: Date.now() }));
    else localStorage.removeItem(KEY);
  } catch (e) {}
}

function rascunhoDinamicoChecar(chave) {
  try {
    const salvo = JSON.parse(localStorage.getItem('rascunho_' + chave) || 'null');
    if (!salvo || !salvo.dados) return null;
    return salvo; // { dados, quando }
  } catch (e) { return null; }
}

// ── Carrega config da clínica do Supabase ──
// Descobre o "slug" da clínica atual a partir da URL (?c=slug).
// Usado só nas páginas públicas, antes de qualquer login existir.
// Enquanto só existe uma clínica no sistema, cai no padrão "anna-carolina".
function obterSlugClinicaDaUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('c') || 'anna-carolina';
}

async function carregarConfigClinica() {
  try {
    const auth = JSON.parse(localStorage.getItem('clinica_auth') || '{}');
    let c = null;

    if (auth.ok && auth.access_token) {
      // Usuário logado: busca a config da PRÓPRIA clínica automaticamente —
      // a segurança do banco (RLS) já filtra sozinha, sem precisar saber o slug.
      const resAuth = await fetch(`${SB_URL}/rest/v1/config_clinica?select=*&limit=1`, {
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${auth.access_token}` }
      });
      const dataAuth = await resAuth.json();
      c = Array.isArray(dataAuth) ? dataAuth[0] : null;
    }

    if (!c) {
      // Página pública ou sem sessão válida: identifica a clínica pela URL
      const slug = obterSlugClinicaDaUrl();
      const resPub = await fetch(`${SB_URL}/rest/v1/config_clinica_publica?select=*&slug=eq.${encodeURIComponent(slug)}&limit=1`, {
        headers: { 'apikey': SB_KEY }
      });
      const dataPub = await resPub.json();
      c = Array.isArray(dataPub) ? dataPub[0] : null;
    }

    if (c) {
      CLINICA_CONFIG.nome          = c.nome          || CLINICA_CONFIG.nome;
      CLINICA_CONFIG.especialidade = c.especialidade || CLINICA_CONFIG.especialidade;
      CLINICA_CONFIG.logo          = c.logo_url      || CLINICA_CONFIG.logo;
      CLINICA_CONFIG.cor           = c.cor_principal || CLINICA_CONFIG.cor;
      CLINICA_CONFIG.telefone      = c.telefone      || '';
      CLINICA_CONFIG.whatsapp      = c.whatsapp      || '';
      CLINICA_CONFIG.endereco      = c.endereco      || '';
      CLINICA_CONFIG.email         = c.email         || '';
      CLINICA_CONFIG.instagram     = c.instagram     || '';
      CLINICA_CONFIG.registro      = c.registro_profissional || '';
      CLINICA_CONFIG.cnpjCpf       = c.cnpj_cpf || '';
      CLINICA_CONFIG.cidade        = c.cidade || '';
      CLINICA_CONFIG.uf            = c.uf || '';
      CLINICA_CONFIG._id           = c.id;
      aplicarCorClinica(c.cor_principal || '#1D9E75');
    }
  } catch(e) { /* usa fallback */ }
}

// ── Aplica a cor da clínica em TODAS as variáveis de tema do sistema ──
// O sistema usa 3 tons derivados de uma cor base: o tom principal (--verde),
// um tom escuro (--verde-e, usado no cabeçalho e textos de destaque) e um
// tom bem claro (--verde-c, usado em fundos suaves). Antes, só --verde era
// trocado pela cor da clínica, deixando cabeçalho e fundos sempre na cor
// padrão (verde) mesmo quando a clínica escolhia outra cor.
function _hexParaRgb(hex) {
  const h = hex.replace('#','');
  const n = h.length === 3 ? h.split('').map(c=>c+c).join('') : h;
  return [parseInt(n.slice(0,2),16), parseInt(n.slice(2,4),16), parseInt(n.slice(4,6),16)];
}
function _rgbParaHex(r,g,b) {
  return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
}
function _escurecer(hex, pct) {
  const [r,g,b] = _hexParaRgb(hex);
  return _rgbParaHex(r*(1-pct), g*(1-pct), b*(1-pct));
}
function _clarear(hex, pct) {
  const [r,g,b] = _hexParaRgb(hex);
  return _rgbParaHex(r+(255-r)*pct, g+(255-g)*pct, b+(255-b)*pct);
}
function aplicarCorClinica(corBase) {
  const root = document.documentElement.style;
  root.setProperty('--verde', corBase);
  root.setProperty('--verde-e', _escurecer(corBase, 0.3));
  root.setProperty('--verde-c', _clarear(corBase, 0.88));
}

// ── Função auxiliar para criar cliente Supabase autenticado ──
function sbClient() {
  const auth = JSON.parse(localStorage.getItem('clinica_auth') || '{}');
  const token = auth.access_token || SB_KEY;
  const { createClient } = supabase;
  return createClient(SB_URL, SB_KEY, {
    global: { headers: { 'Authorization': `Bearer ${token}`, 'apikey': SB_KEY } }
  });
}

// ── Login via Supabase Auth (PIN como senha) ──
async function authLogin(pin, email) {
  try {
    const loginEmail = email || CLINICA_CONFIG.loginEmail;
    const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY },
      body: JSON.stringify({ email: loginEmail, password: pin })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return { ok: false, error: data.error_description || 'PIN incorreto' };
    }
    const expires = Date.now() + 8 * 60 * 60 * 1000;
    localStorage.setItem('clinica_auth', JSON.stringify({
      ok: true, expires,
      access_token: data.access_token,
      refresh_token: data.refresh_token
    }));
    sessionStorage.setItem('clinica_auth', '1');
    return { ok: true };
  } catch(e) {
    return { ok: false, error: 'Erro de conexão.' };
  }
}

// ── Dispara a busca da configuração da clínica assim que este arquivo carrega ──
// Qualquer página pode fazer: await window.CLINICA_CONFIG_PRONTO;
// antes de mostrar nome/logo/registro na tela, garantindo que já veio o dado certo.
window.CLINICA_CONFIG_PRONTO = carregarConfigClinica();
