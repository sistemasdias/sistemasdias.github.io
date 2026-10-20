// Pega o tipo de erro que só aparece quando alguém clica: botão que chama função que não existe
// e código que procura um elemento (id) que não está mais na página.
const test = require('node:test');
const assert = require('node:assert');
const { ler, paginasHtml, scriptsInline } = require('./helpers');

const config = ler('config.js');

// Nomes que o navegador já tem (não precisam estar definidos na página).
const NATIVOS = new Set(['alert', 'confirm', 'prompt', 'window', 'document', 'event', 'this', 'if', 'return',
  'history', 'location', 'navigator', 'console', 'JSON', 'Math', 'Date', 'parseInt', 'parseFloat', 'String',
  'Number', 'Array', 'Object', 'encodeURIComponent', 'setTimeout', 'fetch', 'open', 'print', 'toggle',
  'stopPropagation', 'preventDefault', 'focus', 'click', 'remove', 'select', 'reset', 'submit', 'clear',
  'close', 'scrollTo', 'getElementById', 'querySelector', 'showModal']);

// Ids que o código procura mas não existem como elemento fixo. Só entram aqui casos conferidos à mão:
// código antigo sem chamada ou elemento criado em tempo de execução.
const IDS_CONFERIDOS = {
  'index.html': ['blq-fechar-agenda', 'blq-fim', 'blq-data', 'blq-ini', 'blq-motivo', 'm-bloqueio', // modal de bloqueio antigo (hoje usa prompt)
    'a-valor'],                                                                                      // campo removido; usos protegidos com "if"
  'documentos.html': ['modal-pac-nome', 'modal-lista-trats', 'modal-realizado', 'modal-total-sel',   // abrirModalRealizado não é chamada
    'grupo-saude-mulher'],                                                                            // id montado por template (g.wrapId)
  'paciente.html': ['lemb-txt'],                                                                      // uso protegido com "?."
};

for (const pagina of paginasHtml()) {
  const html = ler(pagina);
  const codigo = scriptsInline(html).join('\n') + '\n' + config;

  test(`botões: toda função chamada em onclick/onchange existe (${pagina})`, () => {
    const definidas = new Set();
    for (const m of codigo.matchAll(/(?:function\s+|window\.|(?:let|const|var)\s+)([A-Za-z_$][\w$]*)/g)) definidas.add(m[1]);
    for (const m of codigo.matchAll(/(?:^|[,;{\s])([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/gm)) definidas.add(m[1]);
    const faltando = new Set();
    for (const m of html.matchAll(/\son(?:click|change|input|submit|keydown|keyup|blur|focus)\s*=\s*"([^"]*)"/g)) {
      for (const c of m[1].matchAll(/(?:^|[;\s(!&|{])([A-Za-z_$][\w$]*)\s*\(/g)) {
        if (!NATIVOS.has(c[1]) && !definidas.has(c[1])) faltando.add(c[1]);
      }
    }
    assert.deepStrictEqual([...faltando], [], `funções chamadas em botões mas não definidas em ${pagina}`);
  });

  test(`ids: getElementById('x') aponta para elemento que existe (${pagina})`, () => {
    const ids = new Set([...html.matchAll(/\bid\s*=\s*\\?["']([^"'\\$]+)["']/g)].map(m => m[1]));
    // ids montados em template ("plck-${i}"): vale o prefixo fixo
    const prefixos = [...html.matchAll(/\bid\s*=\s*\\?["']([^"'\\$]{3,})\$\{/g)].map(m => m[1]);
    const conferidos = new Set(IDS_CONFERIDOS[pagina] || []);
    const sem = new Set();
    for (const m of codigo.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const id = m[1];
      if (ids.has(id) || conferidos.has(id) || prefixos.some(p => id.startsWith(p))) continue;
      sem.add(id);
    }
    assert.deepStrictEqual([...sem], [], `ids procurados no código e ausentes em ${pagina}`);
  });
}
