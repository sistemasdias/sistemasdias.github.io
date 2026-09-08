// Backup automático — Sistema Dias (multi-tenant)
// Roda via GitHub Actions (agendado), usando a service_role key do Supabase.
// Baixa TODAS as tabelas do banco e separa os registros por clínica (clinica_id),
// além de manter um backup consolidado por tabela (compatibilidade / disaster recovery).

const fs = require('fs');
const path = require('path');

const SB_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SB_URL || !SERVICE_KEY) {
  console.error('ERRO: variáveis SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.');
  process.exit(1);
}

// Lista de tabelas — se criar uma tabela nova no banco, adicione o nome aqui também.
// 'clinicas' é a tabela que dá nome/slug a cada clínica (usada para nomear as pastas).
const TABELAS = [
  'clinicas',
  'agenda',
  'anamnese_links',
  'config_clinica',
  'config_custohorario',
  'custos_fixos',
  'custos_variaveis',
  'documentos',
  'estoque_movimentos',
  'financeiro',
  'fornecedores',
  'historico_paciente',
  'pacientes',
  'plano_itens',
  'planos_tratamento',
  'produtos',
];

const PAGE = 1000;

async function fetchAll(tabela) {
  let all = [];
  let offset = 0;
  for (;;) {
    const url = `${SB_URL}/rest/v1/${tabela}?select=*&limit=${PAGE}&offset=${offset}&order=id`;
    const res = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// Nome seguro de pasta a partir do slug/nome da clínica
function pastaClinica(clinica) {
  const base = clinica.slug || clinica.nome || clinica.id;
  return String(base)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main() {
  const hoje = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const outDir = path.join('backups', hoje);
  const globalDir = path.join(outDir, '_consolidado');
  fs.mkdirSync(globalDir, { recursive: true });

  const resumo = { por_tabela: {}, por_clinica: {} };
  let erros = 0;

  // Mapa clinica_id -> nome de pasta (montado a partir da tabela 'clinicas')
  const mapaClinicas = {};

  for (const tabela of TABELAS) {
    process.stdout.write(`Baixando ${tabela}... `);
    try {
      const dados = await fetchAll(tabela);

      // backup consolidado (todas as clínicas juntas, como antes — serve de disaster recovery geral)
      fs.writeFileSync(
        path.join(globalDir, `${tabela}.json`),
        JSON.stringify(dados, null, 2)
      );
      resumo.por_tabela[tabela] = dados.length;
      console.log(`OK (${dados.length} registros)`);

      if (tabela === 'clinicas') {
        for (const c of dados) {
          mapaClinicas[c.id] = pastaClinica(c);
        }
        continue; // 'clinicas' não tem clinica_id próprio, não entra na separação por clínica
      }

      // separa por clinica_id quando o campo existir nos registros
      const semClinica = [];
      const porClinica = {};

      for (const registro of dados) {
        const cid = registro.clinica_id;
        if (!cid) {
          semClinica.push(registro);
          continue;
        }
        if (!porClinica[cid]) porClinica[cid] = [];
        porClinica[cid].push(registro);
      }

      for (const [cid, registros] of Object.entries(porClinica)) {
        const pasta = mapaClinicas[cid] || `clinica-${cid}`;
        const dirClinica = path.join(outDir, pasta);
        fs.mkdirSync(dirClinica, { recursive: true });
        fs.writeFileSync(
          path.join(dirClinica, `${tabela}.json`),
          JSON.stringify(registros, null, 2)
        );
        resumo.por_clinica[pasta] = resumo.por_clinica[pasta] || {};
        resumo.por_clinica[pasta][tabela] = registros.length;
      }

      // registros sem clinica_id preenchido (não deveriam existir pós-migração,
      // mas ficam registrados para investigação em vez de serem descartados)
      if (semClinica.length > 0) {
        const dirSemClinica = path.join(outDir, '_sem_clinica_id');
        fs.mkdirSync(dirSemClinica, { recursive: true });
        fs.writeFileSync(
          path.join(dirSemClinica, `${tabela}.json`),
          JSON.stringify(semClinica, null, 2)
        );
        resumo.por_clinica['_sem_clinica_id'] = resumo.por_clinica['_sem_clinica_id'] || {};
        resumo.por_clinica['_sem_clinica_id'][tabela] = semClinica.length;
      }
    } catch (e) {
      resumo.por_tabela[tabela] = `ERRO: ${e.message}`;
      erros++;
      console.log(`ERRO: ${e.message}`);
    }
  }

  fs.writeFileSync(
    path.join(outDir, '_resumo.json'),
    JSON.stringify({ data: hoje, gerado_em: new Date().toISOString(), ...resumo }, null, 2)
  );

  console.log(`\nBackup concluído em ${outDir}`);
  console.log(`Clínicas separadas: ${Object.keys(mapaClinicas).length}`);
  if (erros > 0) {
    console.error(`Atenção: ${erros} tabela(s) com erro — confira _resumo.json`);
    process.exit(1); // marca o workflow como falho para gerar alerta
  }
}

main().catch((e) => {
  console.error('Falha geral no backup:', e);
  process.exit(1);
});
