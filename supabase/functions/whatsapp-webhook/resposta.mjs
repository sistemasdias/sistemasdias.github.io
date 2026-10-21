// Interpretação das respostas das PACIENTES à mensagem de confirmação de consulta.
// Módulo puro (sem Deno/Supabase) para poder ser testado em Node: tests/resposta.test.js.
//
// Regra de ouro: só reage a mensagens CURTAS e INEQUÍVOCAS ("1", "sim", "não posso"...).
// Qualquer outra coisa é ignorada — quem lê é a recepção. Melhor deixar passar uma resposta
// ambígua do que confirmar/remarcar por engano.

const CONFIRMA = new Set([
  '1', 's', 'ss', 'sim', 'sim obrigado', 'sim obrigada', 'confirmo', 'confirmo sim', 'confirmado',
  'confirmada', 'ok', 'okay', 'ok obrigado', 'ok obrigada', 'blz', 'beleza', 'combinado', 'certo',
  'tudo certo', 'pode ser', 'vou sim', 'estarei la', 'estarei presente', 'ate la', 'ate amanha',
  'confirmo presenca', 'presenca confirmada',
]);

const REMARCA = new Set([
  '2', 'remarcar', 'quero remarcar', 'preciso remarcar', 'queria remarcar', 'gostaria de remarcar',
  'nao posso', 'nao vou', 'nao vou poder', 'nao consigo', 'nao poderei', 'nao vai dar',
  'desmarcar', 'cancelar', 'cancela', 'preciso cancelar', 'quero cancelar', 'queria cancelar',
  'outro dia', 'outro horario', 'adiar', 'preciso adiar',
]);

// minúsculas, sem acento, sem pontuação, espaços únicos. Emoji de "ok" (👍 ✅ 👌 🙏) sozinho
// vale como "ok"; junto de palavras ("confirmado ✅") é só enfeite e é descartado.
export function normalizar(texto) {
  const original = String(texto ?? '');
  let t = original.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t && /[👍✅👌🙏]/u.test(original)) return 'ok';
  return t;
}

// -> 'confirmou' | 'remarcar' | null
export function classificarResposta(texto) {
  const bruto = String(texto ?? '');
  if (bruto.length > 40) return null;      // mensagem longa = conversa de verdade, não resposta
  const t = normalizar(bruto);
  if (!t) return null;
  if (CONFIRMA.has(t)) return 'confirmou';
  if (REMARCA.has(t)) return 'remarcar';
  return null;
}

// Últimos 9 dígitos do telefone (tolera +55, 0 do DDD, formatação)
export function ultimos9(telefone) {
  const d = String(telefone ?? '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : '';
}

function somaDias(iso, dias) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Entre as consultas da paciente, a que a resposta provavelmente se refere: a PRÓXIMA ainda em
// aberto, de hoje até daqui a 4 dias. Passou disso, é conversa fora de contexto → null.
export function escolherConsulta(consultas, hojeISO, janelaDias = 4) {
  const limite = somaDias(hojeISO, janelaDias);
  const candidatas = (consultas || [])
    .filter(c => ['agendado', 'pendente', 'confirmado'].includes(c.status) && c.data >= hojeISO && c.data <= limite)
    .sort((a, b) => (a.data + (a.hora || '')).localeCompare(b.data + (b.hora || '')));
  return candidatas[0] || null;
}
