// Testes das regras de negócio mais delicadas (pacientes, cobrança, agenda, reativação, taxas).
// As funções são extraídas dos próprios arquivos HTML — o que roda aqui é o código de verdade.
const test = require('node:test');
const assert = require('node:assert');
const { ler, scriptsInline, montarDeCodigo, montarDeJs } = require('./helpers');

const codigoIndex = scriptsInline(ler('index.html')).join('\n');
const HOJE = '2026-10-20';
const fmtBRL = v => 'R$ ' + Number(v).toFixed(2).replace('.', ',');
const fDt = s => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };

// ── numeroWhatsApp (config.js) ────────────────────────────────────────────
test('numeroWhatsApp: não duplica o 55 e aceita formatos comuns', () => {
  const { numeroWhatsApp } = montarDeJs('config.js', ['numeroWhatsApp']);
  assert.strictEqual(numeroWhatsApp('(17) 99771-6697'), '5517997716697');
  assert.strictEqual(numeroWhatsApp('+55 17 99771-6697'), '5517997716697'); // já com +55: não vira 5555...
  assert.strictEqual(numeroWhatsApp('5517997716697'), '5517997716697');
  assert.strictEqual(numeroWhatsApp('1732221111'), '551732221111');         // fixo, 10 dígitos
  assert.strictEqual(numeroWhatsApp(''), '');
  assert.strictEqual(numeroWhatsApp(null), '');
});

// ── Ligar consulta à paciente ─────────────────────────────────────────────
function resolvedor(pacs) {
  return montarDeCodigo(codigoIndex, ['_ult9', 'resolverPacienteDaConsulta'], { pacs }).resolverPacienteDaConsulta;
}
test('resolverPacienteDaConsulta: telefone único, com ou sem +55', () => {
  const r = resolvedor([{ id: 'P1', nome: 'Ana Souza', telefone: '(17) 99771-6697' }, { id: 'P2', nome: 'Bia', telefone: '17 98888-0000' }]);
  assert.deepStrictEqual(r('Qualquer', '+55 17 99771-6697'), { id: 'P1', motivo: 'telefone' });
  assert.deepStrictEqual(r('Qualquer', '17997716697'), { id: 'P1', motivo: 'telefone' });
});
test('resolverPacienteDaConsulta: telefone compartilhado só desempata pelo nome exato', () => {
  const r = resolvedor([
    { id: 'M', nome: 'Maria Lima', telefone: '17977771111' },
    { id: 'F', nome: 'Fernanda Lima', apelido: 'Fer', telefone: '17977771111' },
  ]);
  assert.strictEqual(r('Maria Lima', '17977771111').id, 'M');
  assert.strictEqual(r('fer', '17977771111').id, 'F');
  const amb = r('Maria', '17977771111');
  assert.strictEqual(amb.id, null);
  assert.strictEqual(amb.ambiguo, true);
});
test('resolverPacienteDaConsulta: nome exato único; duplicado ou ausente não liga', () => {
  const r = resolvedor([{ id: 'A', nome: 'Ana Souza', telefone: '' }, { id: 'B', nome: 'Joana', telefone: '' }, { id: 'C', nome: 'Joana', telefone: '' }]);
  assert.strictEqual(r('ana souza', '').id, 'A');
  assert.strictEqual(r('Joana', '').ambiguo, true);
  assert.deepStrictEqual(r('eu bike', ''), { id: null });          // compromisso pessoal
  assert.deepStrictEqual(r('Ana', '12345'), { id: null });         // telefone curto demais
});

// ── Cobranças ─────────────────────────────────────────────────────────────
const CONFIG_COBR = { nome: 'Clínica Teste' };
const cobr = montarDeCodigo(codigoIndex,
  ['_cobrDias', '_cobrDesc', '_cobrNome', '_cobrPrimeiroNome', 'classificarCobranca', '_cobrLinhaPix', 'mensagemCobranca'],
  { HOJE_STR: HOJE, fmtBRL, fDt, CLINICA_CONFIG: CONFIG_COBR });
const dia = n => { const d = new Date(HOJE + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

test('classificarCobranca: faixas e estágios', () => {
  const c = (l, e) => cobr.classificarCobranca(l, e);
  assert.deepStrictEqual(c({ data: dia(-3) }, []), { dias: -3, grupo: 'atrasado', estagio: 'atraso' });
  assert.strictEqual(c({ data: dia(-3) }, [{ estagio: 'atraso' }]).estagio, 'atraso2');
  assert.strictEqual(c({ data: dia(0) }, []).grupo, 'hoje');
  assert.strictEqual(c({ data: dia(0) }, []).estagio, 'aviso');
  assert.strictEqual(c({ data: dia(5) }, []).grupo, 'breve');
  assert.strictEqual(c({ data: dia(5) }, []).estagio, 'lembrete');
  assert.strictEqual(c({ data: dia(30) }, []).grupo, 'futuro');
});
test('classificarCobranca: "não cobrar" e "combinado" têm prioridade sobre o atraso', () => {
  const c = l => cobr.classificarCobranca(l, []).grupo;
  assert.strictEqual(c({ data: dia(-10), nao_cobrar: true }), 'silenciado');
  assert.strictEqual(c({ data: dia(-10), nao_cobrar_ate: dia(2) }), 'combinado');
  assert.strictEqual(c({ data: dia(-10), nao_cobrar_ate: dia(-1) }), 'atrasado'); // combinado já venceu
});
test('mensagemCobranca: usa nome, valor e data certos em cada estágio', () => {
  const l = { valor: 600, data: dia(-4), descricao: 'Clareamento — João Silva', pacientes: { nome: 'João Silva' } };
  const m = e => cobr.mensagemCobranca(l, e, -4);
  assert.match(m('lembrete'), /João/);
  assert.match(m('atraso'), /R\$ 600,00/);
  assert.match(m('atraso'), /Clareamento/);
  assert.match(m('atraso2'), /4 dias/);
  assert.match(m('aviso'), /Hoje vence/);
});

test('mensagemCobranca: inclui a chave Pix só quando a clínica configurou', () => {
  const l = { valor: 600, data: dia(-4), descricao: 'Clareamento — João Silva', pacientes: { nome: 'João Silva' } };
  const estagios = ['lembrete', 'aviso', 'atraso', 'atraso2'];
  estagios.forEach(e => assert.doesNotMatch(cobr.mensagemCobranca(l, e, -4), /Pix/));   // sem configuração: igual a antes
  CONFIG_COBR.pixChave = '  17999990000 ';
  CONFIG_COBR.pixTitular = 'Ana Souza';
  try {
    estagios.forEach(e => {
      const m = cobr.mensagemCobranca(l, e, -4);
      assert.match(m, /Pix:\n17999990000\n\(Ana Souza\)/);       // chave sem espaços sobrando, com titular
      assert.ok(m.trimEnd().endsWith('Clínica Teste'));           // assinatura da clínica continua no fim
    });
    CONFIG_COBR.pixTitular = '';
    assert.doesNotMatch(cobr.mensagemCobranca(l, 'atraso', -4), /\(\)/);                   // sem titular: sem parênteses vazios
  } finally { delete CONFIG_COBR.pixChave; delete CONFIG_COBR.pixTitular; }
});

// ── Fechamento da agenda ──────────────────────────────────────────────────
test('consultasSemDesfecho: só dias passados ainda em aberto, da mais recente para a mais antiga', () => {
  const consultas = [
    { id: 1, data: '2026-10-19', hora: '09:00', status: 'agendado' },
    { id: 2, data: HOJE, hora: '09:00', status: 'agendado' },          // hoje não entra
    { id: 3, data: '2026-10-01', hora: '10:00', status: 'confirmado' },
    { id: 4, data: '2026-09-01', hora: '10:00', status: 'realizado' }, // já resolvida
    { id: 5, data: '2026-10-10', hora: '08:00', status: 'aguardando' }, // pedido online
    { id: 6, data: '2026-10-19', hora: '14:00', status: 'pendente' },
    { id: 7, data: '2026-10-05', hora: '08:00', status: 'cancelado' },
  ];
  const { consultasSemDesfecho } = montarDeCodigo(codigoIndex, ['consultasSemDesfecho'], { consultas, HOJE_STR: HOJE });
  assert.deepStrictEqual(consultasSemDesfecho().map(c => c.id), [6, 1, 3]);
});

// ── Reativação ────────────────────────────────────────────────────────────
function reativacao(pacs, consultas) {
  return montarDeCodigo(codigoIndex,
    ['_ultimaVisita', 'listaInativas', 'resultadoReativacao'],
    { pacs, consultas, HOJE_STR: HOJE });
}
test('listaInativas: aplica as exclusões (consulta futura, sem telefone, pendente, já chamada)', () => {
  const tel = '17997716697';
  const pacs = [
    { id: 'a', telefone: tel, data_atendimento: '2025-03-01' },                                   // entra
    { id: 'b', telefone: tel, data_atendimento: '2026-06-01' },                                   // recente
    { id: 'c', telefone: tel, data_atendimento: '2025-01-01' },                                   // consulta futura
    { id: 'd', telefone: '123', data_atendimento: '2025-01-01' },                                 // sem telefone válido
    { id: 'e', telefone: tel, data_atendimento: '2025-01-01', retornos_status: { __reativacao: '2026-10-10' } }, // contatada há 10 dias
    { id: 'f', telefone: tel, data_atendimento: '2025-01-01', cadastro_pendente: true },
    { id: 'g', telefone: tel, data_atendimento: '2024-01-01', tratamentos_adicionais: [{ dataAtendimento: '2026-09-01' }] },
    { id: 'h', telefone: tel, data_atendimento: '2025-01-01' },                                   // consulta realizada recente
  ];
  const consultas = [{ paciente_id: 'c', data: '2026-11-01', status: 'agendado' }, { paciente_id: 'h', data: '2026-08-01', status: 'realizado' }];
  const { listaInativas } = reativacao(pacs, consultas);
  assert.deepStrictEqual(listaInativas(12).map(x => x.p.id), ['a']);
});
test('resultadoReativacao: conta só quem foi chamada e voltou a agendar depois', () => {
  const pacs = [
    { id: 'a', retornos_status: { __reativacao_chamada: '2026-10-10', __reativacao: '2026-10-10' } }, // voltou
    { id: 'b', retornos_status: { __reativacao_chamada: '2026-10-10' } },                              // sem retorno
    { id: 'c', retornos_status: { __reativacao: '2026-10-10' } },                                      // só adiada
    { id: 'd', retornos_status: { __reativacao_chamada: '2026-10-10' } },                              // consulta anterior à chamada
    { id: 'e', retornos_status: { __reativacao_chamada: '2026-10-10' } },                              // consulta cancelada
    { id: 'f', retornos_status: { __reativacao_chamada: '2026-05-01' } },                              // chamada antiga (>120 dias)
    { id: 'g', retornos_status: { __reativacao_chamada: '2026-10-10' }, data_atendimento: '2026-10-15' }, // atendimento depois
  ];
  const consultas = [
    { paciente_id: 'a', status: 'agendado', criado_em: '2026-10-12T14:00:00Z' },
    { paciente_id: 'd', status: 'agendado', criado_em: '2026-09-01T14:00:00Z' },
    { paciente_id: 'e', status: 'cancelado', criado_em: '2026-10-12T14:00:00Z' },
  ];
  const r = reativacao(pacs, consultas).resultadoReativacao();
  assert.deepStrictEqual(r.chamadas.map(p => p.id), ['a', 'b', 'd', 'e', 'g']);
  assert.deepStrictEqual(r.voltaram.map(p => p.id), ['a', 'g']);
});

// ── Resposta da paciente à confirmação (WhatsApp) ────────────────────────
test('badgeRespostaPaciente e pedidosRemarcar: só mostra pedidos de remarcação futuros e não cancelados', () => {
  const consultas = [
    { id: 1, nome: 'Ana', data: '2026-10-22', hora: '10:00', status: 'agendado', paciente_resposta: 'remarcar' },
    { id: 2, nome: 'Bia', data: '2026-10-21', hora: '09:00', status: 'confirmado', paciente_resposta: 'confirmou' },
    { id: 3, nome: 'Cris', data: '2026-10-20', hora: '09:00', status: 'agendado', paciente_resposta: 'remarcar' },   // passou
    { id: 4, nome: 'Dani', data: '2026-10-22', hora: '08:00', status: 'cancelado', paciente_resposta: 'remarcar' },  // já cancelada
    { id: 5, nome: 'Eva', data: '2026-10-21', hora: '08:00', status: 'agendado', paciente_resposta: 'remarcar' },
    { id: 6, nome: 'Fabi', data: '2026-10-23', hora: '08:00', status: 'agendado' },
  ];
  const f = montarDeCodigo(codigoIndex, ['badgeRespostaPaciente', 'pedidosRemarcar'], { consultas, HOJE_STR: '2026-10-21' });
  assert.deepStrictEqual(f.pedidosRemarcar().map(c => c.id), [5, 1]);          // mais cedo primeiro
  assert.match(f.badgeRespostaPaciente(consultas[0]), /REMARCAR/);
  assert.match(f.badgeRespostaPaciente(consultas[1]), /CONFIROU|CONFIRMOU/);
  assert.strictEqual(f.badgeRespostaPaciente(consultas[5]), '');
});

// ── Faturamento líquido (taxas da maquininha) ────────────────────────────
test('resumoLiquido: desconta a taxa só dos lançamentos de cartão já recebidos', () => {
  const { resumoLiquido } = montarDeCodigo(codigoIndex, ['resumoLiquido']);
  const r = resumoLiquido([
    { status: 'recebido', valor: 1000, valor_liquido: 950 },   // cartão com taxa
    { status: 'recebido', valor: 500, valor_liquido: null },   // pix: valor cheio
    { status: 'recebido', valor: 200 },                        // sem a coluna: valor cheio
    { status: 'pendente', valor: 999, valor_liquido: 900 },    // ainda não recebido: fora
  ]);
  assert.deepStrictEqual(r, { bruto: 1700, liquido: 1650, taxas: 50, qtdCartao: 1 });
  assert.deepStrictEqual(resumoLiquido([]), { bruto: 0, liquido: 0, taxas: 0, qtdCartao: 0 });
  assert.deepStrictEqual(resumoLiquido(null), { bruto: 0, liquido: 0, taxas: 0, qtdCartao: 0 });
  // arredondamento de centavos (0,1 + 0,2 não pode virar 0,30000000000000004)
  assert.strictEqual(resumoLiquido([{ status: 'recebido', valor: 0.1, valor_liquido: 0.1 }, { status: 'recebido', valor: 0.2, valor_liquido: 0.2 }]).liquido, 0.3);
});

// ── Data local (não UTC) e "Cidade, data por extenso" nos documentos ─────
test('_dataLocalISO: depois das 21h no Brasil continua sendo o dia de hoje (UTC já virou o dia)', () => {
  const { _dataLocalISO } = montarDeCodigo(codigoIndex, [], {}, ['_dataLocalISO']);
  // 21/10/2026 01:00 UTC = 20/10/2026 22:00 em Brasília (UTC-3 → offset 180)
  const noite = { getTime: () => Date.UTC(2026, 9, 21, 1, 0), getTimezoneOffset: () => 180 };
  assert.strictEqual(_dataLocalISO(noite), '2026-10-20');
  const manha = { getTime: () => Date.UTC(2026, 9, 21, 13, 0), getTimezoneOffset: () => 180 };
  assert.strictEqual(_dataLocalISO(manha), '2026-10-21');
});
test('textoLocalData: "Cidade/UF, 21 de outubro de 2026", sem cidade só a data, data inválida vazio', () => {
  const codigoDocs = scriptsInline(ler('documentos.html')).join('\n');
  const monta = CLINICA_CONFIG => montarDeCodigo(codigoDocs, ['textoLocalData'], { CLINICA_CONFIG }, ['MESES_EXTENSO']).textoLocalData;
  assert.strictEqual(monta({ cidade: 'São José do Rio Preto', uf: 'SP' })('2026-10-21'), 'São José do Rio Preto/SP, 21 de outubro de 2026');
  assert.strictEqual(monta({ cidade: 'Votuporanga' })('2026-03-05'), 'Votuporanga, 5 de março de 2026');
  assert.strictEqual(monta({})('2026-12-01'), '1 de dezembro de 2026');
  assert.strictEqual(monta({ cidade: 'X' })(''), '');
  assert.strictEqual(monta({ cidade: 'X' })(null), '');
});

// ── Taxas da maquininha (Configurações) ───────────────────────────────────
test('taxasCartaoLer: aceita vírgula e %, recusa valor inválido, vazio vira null', () => {
  const codigo = scriptsInline(ler('configuracoes.html')).join('\n');
  const valores = {};
  const document = { getElementById: id => ({ get value() { return valores[id] ?? ''; } }) };
  const { taxasCartaoLer } = montarDeCodigo(codigo, ['taxasCartaoLer'], { document }, ['FORMAS_CARTAO']);
  assert.deepStrictEqual(taxasCartaoLer(), { valor: null });
  valores['taxa-debito'] = '1,5'; valores['taxa-credito-1x'] = '3.2 %';
  assert.deepStrictEqual(taxasCartaoLer(), { valor: { debito: 1.5, 'credito-1x': 3.2 } });
  valores['taxa-credito-4x'] = 'abc';
  assert.match(taxasCartaoLer().erro, /Crédito 4x/);
  valores['taxa-credito-4x'] = '45';
  assert.match(taxasCartaoLer().erro, /Crédito 4x/);
});

// ── Painel de saúde por clínica (admin) ───────────────────────────────────
test('saudeClinicaHtml: 🟢 até 7 dias, 🟡 até 21, 🔴 acima ou nunca', () => {
  const codigo = scriptsInline(ler('admin-assinaturas.html')).join('\n');
  const dias = n => new Date(Date.now() - n * 864e5).toISOString();
  const base = { pacientes_total: 1, consultas_30d: 0, realizadas_30d: 0, faltas_30d: 0, lancamentos_30d: 0, whatsapp_30d: 0 };
  const saudeCache = {
    a: { ...base, ultimo_login: dias(0) }, b: { ...base, ultimo_login: dias(10) },
    c: { ...base, ultimo_login: dias(26) }, d: { ...base, ultimo_login: null },
  };
  const { saudeClinicaHtml } = montarDeCodigo(codigo, ['diasDesde', 'saudeClinicaHtml'], { saudeCache });
  assert.match(saudeClinicaHtml('a'), /🟢/);
  assert.match(saudeClinicaHtml('b'), /🟡/);
  assert.match(saudeClinicaHtml('c'), /🔴/);
  assert.match(saudeClinicaHtml('d'), /nunca acessou/);
  assert.strictEqual(saudeClinicaHtml('inexistente'), '');
});
