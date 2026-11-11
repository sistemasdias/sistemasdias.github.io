// Lixeira: agrupamento da tela e coerência entre migração, tela, backup e permissões.
// O SQL em si foi testado em Postgres local (ver REGRAS.md → Lixeira).
const test = require('node:test');
const assert = require('node:assert');
const { ler, scriptsInline, montarDeCodigo } = require('./helpers');

const codigo = scriptsInline(ler('lixeira.html')).join('\n');
const sql = ler('supabase/migrations/20261111_lixeira.sql');
const { agruparLixeira } = montarDeCodigo(codigo, ['agruparLixeira'], {}, ['JANELA_GRUPO_MS']);

const linha = (id, tabela, paciente_id, minuto, extra = {}) => ({
  id, tabela, paciente_id, paciente_nome: paciente_id ? 'Paciente ' + paciente_id : null,
  excluido_em: new Date(Date.UTC(2026, 10, 11, 12, minuto)).toISOString(), excluido_por_nome: 'Recepção', restaurado_em: null, ...extra,
});

test('agruparLixeira: exclusões seguidas do mesmo paciente viram um grupo, em ordem de restauração', () => {
  const g = agruparLixeira([
    linha('d1', 'documentos', 'P1', 2),
    linha('f1', 'financeiro', 'P1', 0),
    linha('i1', 'plano_itens', 'P1', 1),
    linha('p1', 'planos_tratamento', 'P1', 1),
  ]);
  assert.strictEqual(g.length, 1);
  assert.deepStrictEqual(g[0].itens.map(i => i.id), ['p1', 'i1', 'd1', 'f1']);
  assert.deepStrictEqual(g[0].pendentes.sort(), ['d1', 'f1', 'i1', 'p1']);
});

test('agruparLixeira: mesmo paciente com mais de 3 minutos de diferença são exclusões separadas', () => {
  const g = agruparLixeira([linha('a', 'documentos', 'P1', 0), linha('b', 'documentos', 'P1', 10)]);
  assert.strictEqual(g.length, 2);
  assert.strictEqual(g[0].itens[0].id, 'b');   // mais recente primeiro
});

test('agruparLixeira: pacientes diferentes e linhas sem paciente não se misturam', () => {
  const g = agruparLixeira([linha('a', 'documentos', 'P1', 0), linha('b', 'documentos', 'P2', 0),
    linha('c', 'financeiro', null, 0), linha('d', 'financeiro', null, 0)]);
  assert.strictEqual(g.length, 4);
});

test('agruparLixeira: itens já restaurados saem da lista de pendentes', () => {
  const g = agruparLixeira([linha('a', 'documentos', 'P1', 0, { restaurado_em: '2026-11-11T13:00:00Z' }), linha('b', 'documentos', 'P1', 1)]);
  assert.deepStrictEqual(g[0].pendentes, ['b']);
});

test('migração: as mesmas tabelas no check, no gatilho e na ordem de restauração', () => {
  const lista = s => s.match(/'([a-z_]+)'/g).map(x => x.slice(1, -1)).sort();
  const check = lista(sql.match(/tabela\s+text not null check \(tabela in \(([^)]*)\)\)/)[1]);
  const gatilho = lista(sql.match(/foreach t in array array\[([^\]]*)\]/)[1]);
  const ordem = lista(sql.match(/array_position\(array\[([^\]]*)\]/)[1]);
  assert.deepStrictEqual(gatilho, check);
  assert.deepStrictEqual(ordem, check);
});

test('migração: lixeira só leitura pela tela e funções fechadas para anon', () => {
  assert.match(sql, /revoke all on public\.lixeira from anon, authenticated;/);
  assert.match(sql, /grant select on public\.lixeira to authenticated;/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]*on public\.lixeira/i);
  assert.match(sql, /revoke all on function public\.lixeira_restaurar\(uuid\[\]\) from public, anon;/);
  assert.match(sql, /revoke all on function public\.lixeira_apagar\(uuid\[\]\) from public, anon;/);
  assert.match(sql, /u\.eh_admin/);   // apagar de vez só admin
});

test('lixeira entra no backup diário e na lista de permissões', () => {
  assert.match(ler('backup.js'), /'lixeira'/);
  assert.match(ler('config.js'), /chave:'lixeira'/);
  assert.match(ler('gestao.html'), /href="lixeira\.html"/);
});
