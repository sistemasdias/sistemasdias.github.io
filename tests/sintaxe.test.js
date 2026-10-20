// Nenhuma tela pode ter erro de sintaxe — um único erro derruba a página inteira.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('vm');
const { RAIZ, ler, paginasHtml, scriptsInline } = require('./helpers');

for (const pagina of paginasHtml()) {
  test(`sintaxe: ${pagina}`, () => {
    const scripts = scriptsInline(ler(pagina));
    scripts.forEach((codigo, i) => {
      // type="module"/json não entram: o filtro de scriptsInline pega só <script> comuns
      assert.doesNotThrow(() => new Function(codigo), `script #${i + 1} de ${pagina} tem erro de sintaxe`);
    });
  });
}

for (const arq of fs.readdirSync(RAIZ).filter(f => f.endsWith('.js'))) {
  test(`sintaxe: ${arq}`, () => {
    assert.doesNotThrow(() => new vm.Script(ler(arq), { filename: arq }));
  });
}
