// Divulgação pelo WhatsApp: regras da fila (horário, limite por dia, intervalo, pausa por erro,
// pedido de saída) e regras da tela (filtros, lista sem número repetido, prévia).
// O código testado é o de verdade: fila.mjs / processar.mjs da Edge Function e as funções de divulgacao.html.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { ler, scriptsInline, montarDeCodigo, montarDeJs } = require('./helpers');

const DIR = path.join(__dirname, '..', 'supabase', 'functions', 'divulgacao-processar');
const carregar = arq => import(pathToFileURL(path.join(DIR, arq)).href);

// Horários em UTC; Brasília = UTC-3. 10/11/2026 é terça-feira.
const TER_10H = new Date('2026-11-10T13:00:00Z');
const TER_20H = new Date('2026-11-10T23:00:00Z');
const TER_07H = new Date('2026-11-10T10:00:00Z');
const SAB_18H = new Date('2026-11-14T21:00:00Z');
const SAB_20H = new Date('2026-11-14T23:00:00Z');
const DOM_10H = new Date('2026-11-15T13:00:00Z');

const DIV = { hora_inicio: 9, hora_fim: 19, intervalo_min_seg: 60, intervalo_max_seg: 150, limite_dia: 40 };

// ── fila.mjs ──────────────────────────────────────────────────────────────
test('janela: só de segunda a sábado, dentro do horário de Brasília', async () => {
  const { dentroDaJanela } = await carregar('fila.mjs');
  assert.strictEqual(dentroDaJanela(DIV, TER_10H), true);
  assert.strictEqual(dentroDaJanela(DIV, TER_20H), false);   // depois das 19h
  assert.strictEqual(dentroDaJanela(DIV, TER_07H), false);   // antes das 9h
  assert.strictEqual(dentroDaJanela(DIV, SAB_18H), true);
  assert.strictEqual(dentroDaJanela(DIV, DOM_10H), false);   // domingo nunca
  assert.strictEqual(dentroDaJanela(DIV, new Date('2026-11-10T22:00:00Z')), false); // 19h em ponto: já fechou
});

test('próxima abertura: hoje se ainda não abriu, senão o próximo dia útil (pula domingo)', async () => {
  const { proximaAbertura } = await carregar('fila.mjs');
  assert.strictEqual(proximaAbertura(DIV, TER_07H).toISOString(), '2026-11-10T12:00:00.000Z'); // hoje 9h
  assert.strictEqual(proximaAbertura(DIV, TER_10H).toISOString(), '2026-11-11T12:00:00.000Z'); // bateu o limite: amanhã 9h
  assert.strictEqual(proximaAbertura(DIV, TER_20H).toISOString(), '2026-11-11T12:00:00.000Z');
  assert.strictEqual(proximaAbertura(DIV, SAB_20H).toISOString(), '2026-11-16T12:00:00.000Z'); // sábado à noite → segunda
  assert.strictEqual(proximaAbertura(DIV, DOM_10H).toISOString(), '2026-11-16T12:00:00.000Z'); // domingo → segunda
});

test('intervalo sorteado fica entre o mínimo e o máximo e nunca abaixo de 45 s', async () => {
  const { sortearIntervaloSeg } = await carregar('fila.mjs');
  assert.strictEqual(sortearIntervaloSeg(DIV, 0), 60);
  assert.strictEqual(sortearIntervaloSeg(DIV, 1), 150);
  assert.strictEqual(sortearIntervaloSeg(DIV, 0.5), 105);
  assert.strictEqual(sortearIntervaloSeg({ intervalo_min_seg: 5, intervalo_max_seg: 10 }, 0), 45);
});

test('texto: troca {nome}, some com {nome} quando não há nome e sempre termina com a frase de saída', async () => {
  const { montarTexto, RODAPE_SAIDA } = await carregar('fila.mjs');
  assert.strictEqual(montarTexto('Olá {nome}, tudo bem?', 'Ana'), 'Olá Ana, tudo bem?\n\n' + RODAPE_SAIDA);
  assert.strictEqual(montarTexto('Olá {nome}, tudo bem?', ''), 'Olá, tudo bem?\n\n' + RODAPE_SAIDA);
  assert.strictEqual(montarTexto('', 'Ana'), RODAPE_SAIDA);  // só o vídeo: a legenda é a frase de saída
});

// ── processar.mjs com banco falso ─────────────────────────────────────────
function bancoFalso(t) {
  const construir = (nome) => {
    const st = { filtros: [], op: 'select', dados: null, single: false, limite: null };
    const linhas = () => (t[nome] || []).filter(r => st.filtros.every(f => f(r)));
    const executar = () => {
      if (st.op === 'insert') { (t[nome] = t[nome] || []).push({ ...st.dados }); return { data: null, error: null }; }
      if (st.op === 'update') {
        const af = linhas(); af.forEach(r => Object.assign(r, st.dados));
        return { data: af, error: null };
      }
      let r = linhas();
      if (st.limite) r = r.slice(0, st.limite);
      return { data: st.single ? (r[0] || null) : r, error: null };
    };
    const q = {
      select() { return q; },
      eq(c, v) { st.filtros.push(r => r[c] === v); return q; },
      gte(c, v) { st.filtros.push(r => r[c] != null && r[c] >= v); return q; },
      lte(c, v) { st.filtros.push(r => r[c] != null && r[c] <= v); return q; },
      order() { return q; },
      limit(n) { st.limite = n; return q; },
      maybeSingle() { st.single = true; return Promise.resolve(executar()); },
      update(d) { st.op = 'update'; st.dados = d; return q; },
      insert(d) { st.op = 'insert'; st.dados = d; return Promise.resolve(executar()); },
      then(res, rej) { return Promise.resolve(executar()).then(res, rej); },
    };
    return q;
  };
  return { from: construir };
}

function cenario(extra = {}) {
  const antes = new Date(TER_10H.getTime() - 60000).toISOString();
  return {
    config_clinica: [{ clinica_id: 'C1', divulgacao_whatsapp: true }],
    whatsapp_instancias: [{ clinica_id: 'C1', instancia_nome: 'inst1', ativo: true }],
    pacientes: [{ id: 'P1', sem_divulgacao: false }, { id: 'P2', sem_divulgacao: false }, { id: 'P3', sem_divulgacao: false }],
    divulgacoes: [{ id: 'D1', clinica_id: 'C1', status: 'enviando', mensagem: 'Oi {nome}!', proximo_envio_em: antes,
      iniciado_em: antes, erros_seguidos: 0, ...DIV }],
    divulgacao_envios: [
      { id: 'E1', divulgacao_id: 'D1', clinica_id: 'C1', paciente_id: 'P1', chamada: 'Ana', numero: '5517911110001', status: 'pendente', criado_em: '1' },
      { id: 'E2', divulgacao_id: 'D1', clinica_id: 'C1', paciente_id: 'P2', chamada: 'Bia', numero: '5517911110002', status: 'pendente', criado_em: '2' },
      { id: 'E3', divulgacao_id: 'D1', clinica_id: 'C1', paciente_id: 'P3', chamada: 'Cida', numero: '5517911110003', status: 'pendente', criado_em: '3' },
    ],
    whatsapp_mensagens_enviadas: [],
    ...extra,
  };
}

async function rodar(t, agora = TER_10H, resposta = { ok: true, id: 'm1' }) {
  const { processarFila } = await carregar('processar.mjs');
  const enviados = [];
  const enviar = async (m) => { enviados.push(m); return typeof resposta === 'function' ? resposta(m) : resposta; };
  const resumo = await processarFila(bancoFalso(t), enviar, agora, () => 0);
  return { resumo, enviados };
}

test('fila: envia UMA mensagem por rodada, personalizada, e agenda a próxima respeitando o intervalo', async () => {
  const t = cenario();
  const { resumo, enviados } = await rodar(t);
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].numero, '5517911110001');
  assert.match(enviados[0].texto, /^Oi Ana!\n\nSe não quiser mais receber/);
  assert.strictEqual(t.divulgacao_envios[0].status, 'enviado');
  assert.strictEqual(t.divulgacao_envios[1].status, 'pendente');
  assert.strictEqual(resumo.enviados, 1);
  // próxima só daqui a 60 s (mínimo): chamar de novo no mesmo instante não envia nada
  assert.strictEqual(t.divulgacoes[0].proximo_envio_em, new Date(TER_10H.getTime() + 60000).toISOString());
  const de_novo = await rodar(t);
  assert.strictEqual(de_novo.enviados.length, 0);
  assert.strictEqual(t.whatsapp_mensagens_enviadas.length, 1);   // fica no histórico de mensagens da clínica
});

test('fila: clínica com o recurso desligado não envia nada', async () => {
  const t = cenario({ config_clinica: [{ clinica_id: 'C1', divulgacao_whatsapp: false }] });
  const { enviados, resumo } = await rodar(t);
  assert.strictEqual(enviados.length, 0);
  assert.strictEqual(resumo.desligadas, 1);
  assert.strictEqual(t.divulgacao_envios[0].status, 'pendente');
});

test('fila: fora do horário e no domingo não envia; adia para a próxima abertura', async () => {
  for (const [agora, volta] of [[TER_20H, '2026-11-11T12:00:00.000Z'], [DOM_10H, '2026-11-16T12:00:00.000Z']]) {
    const t = cenario();
    t.divulgacoes[0].proximo_envio_em = new Date(agora.getTime() - 60000).toISOString();
    const { enviados } = await rodar(t, agora);
    assert.strictEqual(enviados.length, 0);
    assert.strictEqual(t.divulgacoes[0].proximo_envio_em, volta);
  }
});

test('fila: ao bater o limite do dia (somando todas as divulgações da clínica) para até amanhã', async () => {
  const t = cenario();
  t.divulgacoes[0].limite_dia = 2;
  const hojeCedo = new Date(TER_10H.getTime() - 3600e3).toISOString();
  t.divulgacao_envios.push(
    { id: 'X1', divulgacao_id: 'OUTRA', clinica_id: 'C1', status: 'enviado', enviado_em: hojeCedo },
    { id: 'X2', divulgacao_id: 'OUTRA', clinica_id: 'C1', status: 'enviado', enviado_em: hojeCedo },
    { id: 'X3', divulgacao_id: 'OUTRA', clinica_id: 'C2', status: 'enviado', enviado_em: hojeCedo }, // outra clínica não conta
  );
  const { enviados } = await rodar(t);
  assert.strictEqual(enviados.length, 0);
  assert.strictEqual(t.divulgacoes[0].proximo_envio_em, '2026-11-11T12:00:00.000Z');
  // envio de ONTEM não conta para hoje
  const t2 = cenario(); t2.divulgacoes[0].limite_dia = 1;
  t2.divulgacao_envios.push({ id: 'Y1', divulgacao_id: 'OUTRA', clinica_id: 'C1', status: 'enviado', enviado_em: '2026-11-09T18:00:00.000Z' });
  assert.strictEqual((await rodar(t2)).enviados.length, 1);
});

test('fila: duas divulgações da mesma clínica não enviam na mesma rodada', async () => {
  const t = cenario();
  t.divulgacoes.push({ ...t.divulgacoes[0], id: 'D2', iniciado_em: new Date(TER_10H.getTime() - 1000).toISOString() });
  t.divulgacao_envios.push({ id: 'F1', divulgacao_id: 'D2', clinica_id: 'C1', numero: '5517922220001', status: 'pendente', criado_em: '1' });
  const { enviados } = await rodar(t);
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].divulgacao.id, 'D1');   // a que começou primeiro
});

test('fila: paciente que pediu para sair depois de entrar na lista é pulada, sem envio', async () => {
  const t = cenario();
  t.pacientes[0].sem_divulgacao = true;
  const { enviados, resumo } = await rodar(t);
  assert.strictEqual(enviados.length, 0);
  assert.strictEqual(t.divulgacao_envios[0].status, 'pulado');
  assert.strictEqual(resumo.pulados, 1);
  assert.strictEqual(t.divulgacoes[0].proximo_envio_em, TER_10H.toISOString()); // não gasta o intervalo
});

test('fila: três erros seguidos pausam a divulgação sozinha; um sucesso zera a contagem', async () => {
  const t = cenario();
  let agora = TER_10H;
  for (let i = 0; i < 3; i++) {
    t.divulgacoes[0].proximo_envio_em = new Date(agora.getTime() - 1000).toISOString();
    await rodar(t, agora, { ok: false, erro: 'Connection Closed' });
    agora = new Date(agora.getTime() + 120000);
  }
  assert.strictEqual(t.divulgacoes[0].status, 'pausada');
  assert.match(t.divulgacoes[0].motivo_pausa, /3 envios seguidos falharam.*Connection Closed/);
  assert.deepStrictEqual(t.divulgacao_envios.map(e => e.status), ['erro', 'erro', 'erro']);

  const t2 = cenario(); t2.divulgacoes[0].erros_seguidos = 2;
  await rodar(t2);
  assert.strictEqual(t2.divulgacoes[0].erros_seguidos, 0);
  assert.strictEqual(t2.divulgacoes[0].status, 'enviando');
});

test('fila: sem WhatsApp conectado pausa com aviso; ao enviar a última, conclui', async () => {
  const t = cenario({ whatsapp_instancias: [] });
  await rodar(t);
  assert.strictEqual(t.divulgacoes[0].status, 'pausada');
  assert.match(t.divulgacoes[0].motivo_pausa, /Nenhum WhatsApp conectado/);
  assert.strictEqual(t.divulgacao_envios[0].status, 'pendente');

  const t2 = cenario(); t2.divulgacao_envios.length = 1;
  await rodar(t2);
  assert.strictEqual(t2.divulgacoes[0].status, 'concluida');
  assert.ok(t2.divulgacoes[0].concluido_em);
});

test('fila: divulgação pausada, cancelada ou com próximo envio no futuro é ignorada', async () => {
  for (const mud of [{ status: 'pausada' }, { status: 'cancelada' }, { proximo_envio_em: new Date(TER_10H.getTime() + 30000).toISOString() }]) {
    const t = cenario(); Object.assign(t.divulgacoes[0], mud);
    assert.strictEqual((await rodar(t)).enviados.length, 0);
  }
});

// ── Tela (divulgacao.html) ────────────────────────────────────────────────
const codigoTela = scriptsInline(ler('divulgacao.html')).join('\n');
const { numeroWhatsApp } = montarDeJs('config.js', ['numeroWhatsApp']);
const tela = montarDeCodigo(codigoTela,
  ['semAcento', 'chamada', 'numeroValido', 'ultimaVisita', 'procedimentosDe', 'filtrarPacientes', 'montarEnvios', 'textoFinal', 'estimar'],
  { numeroWhatsApp }, ['RODAPE_SAIDA']);

const PACS = [
  { id: 'P1', nome: 'Ana Souza', apelido: 'Aninha', telefone: '(17) 99771-6697', tratamento: 'Toxina Botulínica (Botox)', data_atendimento: '2026-09-01', criado_em: '2025-01-01T10:00:00Z' },
  { id: 'P2', nome: 'Bia Lima', telefone: '17 98888-0000', tratamento: 'Limpeza', tratamentos_adicionais: [{ nome: 'Preenchimento labial', dataAtendimento: '2025-08-10' }], data_atendimento: '2025-03-01' },
  { id: 'P3', nome: 'Júlia Lima', telefone: '+55 17 98888-0000', tratamento: 'Clareamento', data_atendimento: '2026-11-01' },   // mesmo celular da mãe
  { id: 'P4', nome: 'Carla Sem Fone', telefone: '3222-1111', tratamento: 'Botox' },
];

test('tela: a frase de saída da prévia é a mesma que o servidor envia', async () => {
  const { RODAPE_SAIDA, montarTexto } = await carregar('fila.mjs');
  assert.strictEqual(tela.RODAPE_SAIDA, RODAPE_SAIDA);
  for (const [m, n] of [['Olá {nome}!', 'Ana'], ['Olá {nome}, veja', ''], ['', 'Ana'], ['  texto  ', 'Bia']]) {
    assert.strictEqual(tela.textoFinal(m, n), montarTexto(m, n));
  }
});

test('tela: filtros por nome, procedimento (sem acento, parte do nome) e última visita', () => {
  const ids = f => tela.filtrarPacientes(PACS, { busca: '', proc: '', visita: '', ...f }, '2026-11-10').map(p => p.id);
  assert.deepStrictEqual(ids({}), ['P1', 'P2', 'P3', 'P4']);
  assert.deepStrictEqual(ids({ busca: 'julia' }), ['P3']);
  assert.deepStrictEqual(ids({ busca: 'aninha' }), ['P1']);                 // apelido
  assert.deepStrictEqual(ids({ proc: 'botox' }), ['P1', 'P4']);
  assert.deepStrictEqual(ids({ proc: 'botulinica' }), ['P1']);
  assert.deepStrictEqual(ids({ proc: 'preenchimento' }), ['P2']);           // tratamento adicional
  assert.deepStrictEqual(ids({ visita: 'ate6' }), ['P1', 'P3']);
  assert.deepStrictEqual(ids({ visita: 'mais12' }), ['P2']);                // última: 10/08/2025
  assert.deepStrictEqual(ids({ visita: 'mais6' }), ['P2']);
});

test('tela: a fila tem uma linha por número (celular repetido e telefone inválido ficam de fora)', () => {
  const envios = tela.montarEnvios(PACS);
  assert.deepStrictEqual(envios.map(e => e.paciente_id), ['P1', 'P2']);
  assert.deepStrictEqual(envios[0], { paciente_id: 'P1', nome: 'Ana Souza', chamada: 'Aninha', numero: '5517997716697' });
  assert.strictEqual(envios[1].chamada, 'Bia');
});

test('tela: estimativa de dias e de duração por dia', () => {
  assert.deepStrictEqual(tela.estimar(100, 40, 60, 150), { dias: 3, minutosPorDia: 70 });
  assert.deepStrictEqual(tela.estimar(10, 40, 60, 150), { dias: 1, minutosPorDia: 18 });
  assert.deepStrictEqual(tela.estimar(0, 40, 60, 150), { dias: 0, minutosPorDia: 0 });
});
