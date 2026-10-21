// Interpretação das respostas das pacientes no WhatsApp (módulo da Edge Function whatsapp-webhook).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const carregar = () => import(pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', 'whatsapp-webhook', 'resposta.mjs')).href);

test('classificarResposta: confirmações inequívocas', async () => {
  const { classificarResposta } = await carregar();
  for (const t of ['1', 'Sim', 'SIM!', 'sim.', 'Confirmo', 'confirmado ✅', '👍', '✅', 'Ok', 'ok, obrigada', 'Beleza!', 'Estarei lá', 'até amanhã', 'Pode ser', 'vou sim']) {
    assert.strictEqual(classificarResposta(t), 'confirmou', `"${t}" deveria confirmar`);
  }
});

test('classificarResposta: pedidos de remarcação', async () => {
  const { classificarResposta } = await carregar();
  for (const t of ['2', 'Remarcar', 'quero remarcar', 'Não posso', 'nao vou poder!', 'não consigo', 'Preciso cancelar', 'desmarcar', 'outro dia', 'adiar']) {
    assert.strictEqual(classificarResposta(t), 'remarcar', `"${t}" deveria pedir remarcação`);
  }
});

test('classificarResposta: ambíguo, longo ou fora de contexto é ignorado (a recepção lê)', async () => {
  const { classificarResposta } = await carregar();
  for (const t of ['', '   ', 'Oi', 'bom dia', 'quanto custa o botox?', 'sim, mas posso chegar 15 minutos atrasada?',
                   'não', 'talvez', '3', '11', 'ok vou ver se consigo e te aviso mais tarde sobre o horário certinho',
                   'Obrigada! Sua consulta está confirmada 💚', null, undefined]) {
    assert.strictEqual(classificarResposta(t), null, `"${t}" deveria ser ignorado`);
  }
});

test('ultimos9: tolera +55, formatação e telefone curto', async () => {
  const { ultimos9 } = await carregar();
  assert.strictEqual(ultimos9('+55 (17) 99771-6697'), '997716697');
  assert.strictEqual(ultimos9('17997716697'), '997716697');
  assert.strictEqual(ultimos9('5517997716697'), '997716697');
  assert.strictEqual(ultimos9('12345'), '');
  assert.strictEqual(ultimos9(null), '');
});

test('escolherConsulta: a próxima em aberto dentro de 4 dias; fora da janela ou resolvida não vale', async () => {
  const { escolherConsulta } = await carregar();
  const hoje = '2026-10-21';
  const cs = [
    { id: 'passada', data: '2026-10-20', hora: '10:00', status: 'agendado' },
    { id: 'cancelada', data: '2026-10-21', hora: '08:00', status: 'cancelado' },
    { id: 'longe', data: '2026-10-30', hora: '09:00', status: 'agendado' },
    { id: 'depois', data: '2026-10-23', hora: '09:00', status: 'agendado' },
    { id: 'proxima', data: '2026-10-22', hora: '15:00', status: 'agendado' },
    { id: 'mesmoDiaCedo', data: '2026-10-22', hora: '09:00', status: 'confirmado' },
  ];
  assert.strictEqual(escolherConsulta(cs, hoje).id, 'mesmoDiaCedo');
  assert.strictEqual(escolherConsulta([cs[0], cs[1], cs[2]], hoje), null);
  assert.strictEqual(escolherConsulta([], hoje), null);
  assert.strictEqual(escolherConsulta(null, hoje), null);
  // limite da janela: hoje + 4 dias entra, + 5 não
  assert.strictEqual(escolherConsulta([{ id: 'x', data: '2026-10-25', hora: '09:00', status: 'agendado' }], hoje).id, 'x');
  assert.strictEqual(escolherConsulta([{ id: 'y', data: '2026-10-26', hora: '09:00', status: 'agendado' }], hoje), null);
});
