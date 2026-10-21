// Ajudantes dos testes. Sem dependências: só Node (node --test tests/).
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

function ler(arquivo) {
  return fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
}

function paginasHtml() {
  return fs.readdirSync(RAIZ).filter(f => f.endsWith('.html')).sort();
}

// Scripts inline (sem src) de uma página, na ordem.
function scriptsInline(html) {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  const saida = [];
  let m;
  while ((m = re.exec(html))) saida.push(m[1]);
  return saida;
}

// Devolve o texto de `function nome(...) {...}` (ou `async function`), contando chaves e
// ignorando as que aparecem dentro de strings, templates e comentários.
function extrairFuncao(codigo, nome) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + nome + '\\s*\\(');
  const ini = codigo.search(re);
  if (ini < 0) throw new Error('função não encontrada: ' + nome);
  let i = codigo.indexOf('{', codigo.indexOf(')', ini));
  const fim = fecharBloco(codigo, i);
  return codigo.slice(ini, fim + 1);
}

// Variável de topo (let/const) de uma linha: `let _x = ...;`
function extrairLinha(codigo, nome) {
  const re = new RegExp('^(?:let|const|var)\\s+' + nome + '\\b.*$', 'm');
  const m = codigo.match(re);
  if (!m) throw new Error('declaração não encontrada: ' + nome);
  return m[0];
}

function fecharBloco(s, abre) {
  let prof = 0;
  for (let i = abre; i < s.length; i++) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') { i = s.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && s[i + 1] === '*') { i = s.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"') { i = fimString(s, i, c); continue; }
    if (c === '`') { i = fimTemplate(s, i); continue; }
    if (c === '{') prof++;
    else if (c === '}') { prof--; if (prof === 0) return i; }
  }
  throw new Error('bloco sem fechamento');
}
function fimString(s, i, aspa) {
  for (i++; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === aspa) return i;
  }
  return i;
}
function fimTemplate(s, i) {
  for (i++; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '`') return i;
    if (s[i] === '$' && s[i + 1] === '{') { i = fecharBloco(s, i + 1); }
  }
  return i;
}

// Monta funções de uma página para testar: `contexto` são as variáveis que elas esperam
// existir (pacs, consultas, HOJE_STR, document, ...). `linhas` são declarações de topo
// (let/const) a copiar junto.
function montar(arquivo, nomes, contexto = {}, linhas = []) {
  const codigo = scriptsInline(ler(arquivo)).join('\n') + '\n' + (arquivo.endsWith('.js') ? '' : '');
  return montarDeCodigo(codigo, nomes, contexto, linhas);
}
function montarDeJs(arquivo, nomes, contexto = {}, linhas = []) {
  return montarDeCodigo(ler(arquivo), nomes, contexto, linhas);
}
function montarDeCodigo(codigo, nomes, contexto = {}, linhas = []) {
  const partes = linhas.map(l => extrairLinha(codigo, l));
  nomes.forEach(n => partes.push(extrairFuncao(codigo, n)));
  const chaves = Object.keys(contexto);
  const fabrica = new Function(...chaves, partes.join('\n') + '\nreturn {' + [...nomes, ...linhas].join(',') + '};');
  return fabrica(...chaves.map(k => contexto[k]));
}

module.exports = { RAIZ, ler, paginasHtml, scriptsInline, extrairFuncao, montar, montarDeJs, montarDeCodigo };
