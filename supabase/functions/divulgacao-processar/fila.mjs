// Regras da fila de divulgação: horário permitido, intervalo, limite por dia e texto final.
// Módulo puro (sem Deno/Supabase) para poder ser testado em Node: tests/divulgacao.test.js.

// Frase de saída acrescentada a TODA divulgação (LGPD: a paciente pode se opor a qualquer momento).
// A tela (divulgacao.html) mostra a mesma frase na prévia — um teste confere que são iguais.
export const RODAPE_SAIDA = 'Se não quiser mais receber nossas novidades, responda SAIR.';

// Erros seguidos que pausam a divulgação sozinha (ex.: WhatsApp da clínica desconectou).
export const MAX_ERROS_SEGUIDOS = 3;

const TRES_HORAS = 3 * 60 * 60 * 1000;

// A clínica opera em horário de Brasília (UTC-3, sem horário de verão); o servidor roda em UTC.
export function agoraBrasilia(agora = new Date()) {
  const b = new Date(agora.getTime() - TRES_HORAS);
  return {
    hora: b.getUTCHours(),
    diaSemana: b.getUTCDay(), // 0 = domingo
    data: b.toISOString().slice(0, 10),
  };
}

// Só envia de segunda a sábado, dentro do horário da divulgação. Nunca de madrugada nem domingo.
export function dentroDaJanela(d, agora = new Date()) {
  const b = agoraBrasilia(agora);
  if (b.diaSemana === 0) return false;
  return b.hora >= d.hora_inicio && b.hora < d.hora_fim;
}

// Instante (UTC) em que começou o dia de hoje em Brasília — base da contagem do limite diário.
export function inicioDoDia(agora = new Date()) {
  const { data } = agoraBrasilia(agora);
  return new Date(`${data}T03:00:00.000Z`);
}

// Próximo instante em que a divulgação pode voltar a enviar: o início da janela do próximo dia
// útil (ou de hoje mesmo, se ainda não abriu). Usado quando bate o limite do dia ou fecha o horário.
export function proximaAbertura(d, agora = new Date()) {
  const b = agoraBrasilia(agora);
  const base = inicioDoDia(agora).getTime(); // 00:00 de hoje em Brasília
  let dias = b.diaSemana !== 0 && b.hora < d.hora_inicio ? 0 : 1;
  const diaSemana = (b.diaSemana + dias) % 7;
  if (diaSemana === 0) dias += 1; // domingo → segunda
  return new Date(base + dias * 24 * 60 * 60 * 1000 + d.hora_inicio * 60 * 60 * 1000);
}

// Intervalo sorteado entre o mínimo e o máximo: mensagens em ritmo irregular parecem conversa,
// não disparo. `sorteio` (0 a 1) é injetável para o teste.
export function sortearIntervaloSeg(d, sorteio = Math.random()) {
  const min = Math.max(45, Number(d.intervalo_min_seg) || 60);
  const max = Math.max(min, Number(d.intervalo_max_seg) || min);
  return Math.round(min + (max - min) * sorteio);
}

// Texto que a paciente recebe: {nome} trocado pelo nome dela + frase de saída no fim.
export function montarTexto(mensagem, chamada) {
  const nome = String(chamada || '').trim();
  let t = String(mensagem || '').trim();
  // Sem nome cadastrado: tira o {nome} e a pontuação/espaço que sobraria ("Olá , tudo bem" → "Olá, tudo bem")
  t = nome ? t.replace(/\{nome\}/gi, nome) : t.replace(/\s*\{nome\}/gi, '');
  return (t ? t + '\n\n' : '') + RODAPE_SAIDA;
}

// Entre várias divulgações "enviando", uma só por clínica a cada chamada: a que começou primeiro.
export function umaPorClinica(divulgacoes) {
  const porClinica = new Map();
  const ordenadas = [...(divulgacoes || [])].sort((a, b) =>
    String(a.iniciado_em || a.criado_em || '').localeCompare(String(b.iniciado_em || b.criado_em || '')));
  for (const d of ordenadas) if (!porClinica.has(d.clinica_id)) porClinica.set(d.clinica_id, d);
  return [...porClinica.values()];
}
