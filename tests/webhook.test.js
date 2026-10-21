// Fluxo real da Edge Function whatsapp-webhook (resposta das pacientes), com banco falso em memória.
// O código testado é o do próprio arquivo index.ts: tiramos os tipos (node:module) e injetamos
// no lugar do Supabase/Deno um banco de mentira e um "fetch" que só anota o que seria enviado.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { stripTypeScriptTypes } = require('node:module');

const DIR = path.join(__dirname, '..', 'supabase', 'functions', 'whatsapp-webhook');
const HOJE = (() => { const d = new Date(Date.now() - 3 * 3600e3); return d.toISOString().slice(0, 10); })();
const soma = n => { const d = new Date(HOJE + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Banco falso: tabelas = arrays de objetos; suporta o subconjunto de consultas que o webhook usa.
function bancoFalso(tabelas) {
  const construir = (nome) => {
    const st = { filtros: [], op: 'select', dados: null, opcoes: null, single: false };
    const linhas = () => (tabelas[nome] || []).filter(r => st.filtros.every(f => f(r)));
    const executar = () => {
      if (st.op === 'update') {
        linhas().forEach(r => Object.assign(r, st.dados));
        return { data: null, error: null };
      }
      if (st.op === 'upsert') {
        const novas = [];
        for (const l of st.dados) {
          if ((tabelas[nome] = tabelas[nome] || []).some(r => r.message_id === l.message_id)) continue;
          tabelas[nome].push({ ...l }); novas.push({ ...l });
        }
        return { data: novas, error: null };
      }
      const r = linhas();
      return { data: st.single ? (r[0] || null) : r, error: null };
    };
    const q = {
      select() { return q; },
      eq(c, v) { st.filtros.push(r => r[c] === v); return q; },
      neq(c, v) { st.filtros.push(r => r[c] !== v); return q; },
      gte(c, v) { st.filtros.push(r => r[c] >= v); return q; },
      lte(c, v) { st.filtros.push(r => r[c] <= v); return q; },
      in(c, vs) { st.filtros.push(r => vs.includes(r[c])); return q; },
      order() { return q; },
      maybeSingle() { st.single = true; return Promise.resolve(executar()); },
      update(d) { st.op = 'update'; st.dados = d; return q; },
      upsert(d, o) { st.op = 'upsert'; st.dados = d; st.opcoes = o; return q; },
      then(res, rej) { return Promise.resolve(executar()).then(res, rej); },
    };
    return q;
  };
  return { from: construir };
}

async function montarWebhook(tabelas) {
  const fonte = stripTypeScriptTypes(fs.readFileSync(path.join(DIR, 'index.ts'), 'utf8'))
    .replace(/^import .*$/gm, '');
  const enviados = [];
  let handler;
  const Deno = { env: { get: k => ({ EVOLUTION_API_URL: 'http://evo', EVOLUTION_API_KEY: 'k', SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 's' })[k] }, serve: h => { handler = h; } };
  const fetchFalso = async (url, o) => { enviados.push({ url, corpo: JSON.parse(o.body) }); return { ok: true }; };
  const mod = await import(pathToFileURL(path.join(DIR, 'resposta.mjs')).href);
  new Function('createClient', 'classificarResposta', 'escolherConsulta', 'ultimos9', 'Deno', 'fetch',
    fonte)(() => bancoFalso(tabelas), mod.classificarResposta, mod.escolherConsulta, mod.ultimos9, Deno, fetchFalso);
  const chamar = (texto, { jid = '5517997716697@s.whatsapp.net', fromMe = false, id } = {}) =>
    handler({
      method: 'POST', url: 'http://x/', headers: { get: () => null },
      json: async () => ({ event: 'messages.upsert', instance: 'inst1', data: { key: { id: id || Math.random().toString(36), remoteJid: jid, fromMe }, message: { conversation: texto } } }),
    }).then(r => r.json());
  return { chamar, enviados };
}

function cenario(modo, extra = {}) {
  return {
    whatsapp_instancias: [{ instancia_nome: 'inst1', clinica_id: 'C1' }],
    whatsapp_mensagens_recebidas: [],
    config_clinica: [{ clinica_id: 'C1', nome: 'Clínica Teste', whatsapp_confirmacao: modo, whatsapp_numeros_autorizados: '5517988887777' }],
    pacientes: [{ id: 'P1', telefone: '(17) 99771-6697' }],
    agenda: [
      { id: 'A1', clinica_id: 'C1', nome: 'Maria Silva', telefone: '17997716697', paciente_id: 'P1', data: soma(1), hora: '10:00:00', status: 'agendado', paciente_resposta: null, procedimento: 'Limpeza' },
      { id: 'A2', clinica_id: 'C1', nome: 'Outra Pessoa', telefone: '17911112222', paciente_id: null, data: soma(1), hora: '09:00:00', status: 'agendado', paciente_resposta: null },
      { id: 'A3', clinica_id: 'C2', nome: 'Maria Silva', telefone: '17997716697', paciente_id: null, data: soma(1), hora: '08:00:00', status: 'agendado', paciente_resposta: null }, // outra clínica
    ],
    ...extra,
  };
}

test('modo desligado (padrão): resposta da paciente é ignorada', async () => {
  const t = cenario('off'); const { chamar, enviados } = await montarWebhook(t);
  await chamar('1');
  assert.strictEqual(t.agenda[0].status, 'agendado');
  assert.strictEqual(t.agenda[0].paciente_resposta, null);
  assert.strictEqual(enviados.length, 0);
});

test('modo registrar: "1" confirma a consulta da paciente certa, sem mandar mensagem', async () => {
  const t = cenario('registrar'); const { chamar, enviados } = await montarWebhook(t);
  await chamar('1');
  assert.strictEqual(t.agenda[0].status, 'confirmado');
  assert.strictEqual(t.agenda[0].paciente_resposta, 'confirmou');
  assert.ok(t.agenda[0].paciente_respondeu_em);
  assert.strictEqual(t.agenda[1].status, 'agendado');   // outra paciente: intacta
  assert.strictEqual(t.agenda[2].status, 'agendado');   // outra clínica: intacta
  assert.strictEqual(enviados.length, 0);
});

test('modo responder: confirma e agradece uma vez; resposta repetida não gera nova mensagem', async () => {
  const t = cenario('responder'); const { chamar, enviados } = await montarWebhook(t);
  await chamar('sim');
  assert.strictEqual(t.agenda[0].status, 'confirmado');
  assert.strictEqual(enviados.length, 1);
  assert.match(enviados[0].corpo.text, /Obrigada, Maria/);
  assert.strictEqual(enviados[0].corpo.number, '5517997716697');
  await chamar('ok');                                    // responde "ok" ao agradecimento
  assert.strictEqual(enviados.length, 1);                // sem vai-e-vem
});

test('"2"/"não posso": marca pedido de remarcação, NÃO cancela e avisa a paciente', async () => {
  const t = cenario('responder'); const { chamar, enviados } = await montarWebhook(t);
  await chamar('Não posso');
  assert.strictEqual(t.agenda[0].paciente_resposta, 'remarcar');
  assert.strictEqual(t.agenda[0].status, 'agendado');    // nada cancelado
  assert.match(enviados[0].corpo.text, /novo horário/);
});

test('mensagens que não são resposta clara, do próprio número da clínica ou de desconhecidos são ignoradas', async () => {
  const t = cenario('responder'); const { chamar, enviados } = await montarWebhook(t);
  await chamar('quanto custa o clareamento?');
  await chamar('sim', { fromMe: true });                                   // a clínica escrevendo
  await chamar('sim', { jid: '5517900000000@s.whatsapp.net' });            // número sem consulta
  assert.strictEqual(t.agenda.filter(a => a.paciente_resposta).length, 0);
  assert.strictEqual(enviados.length, 0);
});

test('consulta longe (mais de 4 dias) ou já cancelada não é afetada', async () => {
  const t = cenario('registrar');
  t.agenda[0].data = soma(10);
  t.agenda.push({ id: 'A4', clinica_id: 'C1', nome: 'Maria Silva', telefone: '17997716697', data: soma(1), hora: '08:00:00', status: 'cancelado', paciente_resposta: null });
  const { chamar } = await montarWebhook(t);
  await chamar('1');
  assert.strictEqual(t.agenda[0].paciente_resposta, null);
  assert.strictEqual(t.agenda[3].paciente_resposta, null);
});

test('número autorizado da clínica continua usando comandos e nunca é tratado como paciente', async () => {
  const t = cenario('responder'); t.agenda[0].telefone = '17988887777';
  const { chamar, enviados } = await montarWebhook(t);
  await chamar('1', { jid: '5517988887777@s.whatsapp.net' });
  assert.strictEqual(t.agenda[0].paciente_resposta, null);
  assert.strictEqual(enviados.length, 0);
});
