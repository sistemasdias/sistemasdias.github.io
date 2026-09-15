// Edge Function: whatsapp-webhook
// Recebe os eventos MESSAGES_UPSERT que a Evolution API dispara a cada
// mensagem (enviada ou recebida) de uma instância conectada.
// Não usa verify_jwt — a Evolution não manda um JWT do Supabase, então a
// própria Evolution deve ser configurada com o header/segredo abaixo.
// Só grava com a service_role key, que ignora RLS por natureza.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function extrairTexto(message: Record<string, unknown> | undefined | null): string {
  if (!message) return '';
  const m = message as Record<string, any>;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  );
}

function soDigitos(s: string): string {
  return String(s || '').replace(/\D/g, '');
}

// Compara números tolerando presença/ausência de código do país (55) —
// um é considerado o mesmo do outro se um "termina" com o outro.
function numerosBatem(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.endsWith(b) || b.endsWith(a);
}

async function enviarTexto(instanciaNome: string, numero: string, texto: string) {
  const evolutionUrl = Deno.env.get('EVOLUTION_API_URL')!;
  const evolutionKey = Deno.env.get('EVOLUTION_API_KEY')!;
  try {
    await fetch(`${evolutionUrl}/message/sendText/${instanciaNome}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evolutionKey },
      body: JSON.stringify({ number: numero, text: texto }),
    });
  } catch (e) {
    console.error('[enviarTexto]', e);
  }
}

const MSG_FORMATO =
  'Não entendi o comando. Use exatamente este formato:\n\n' +
  'agendar: Nome completo do paciente, DD/MM HH:MM, Procedimento (opcional)\n\n' +
  'Exemplos:\n' +
  'agendar: Claudio Gallego Dias Filho, 16/09 14:00\n' +
  'agendar: Claudio Gallego Dias Filho, 16/09 14:00, Botox';

interface ComandoAgendar {
  nome: string;
  data: string; // YYYY-MM-DD
  hora: string; // HH:MM
  procedimento: string | null;
}

function parseComandoAgendar(texto: string): ComandoAgendar | null {
  const semPrefixo = texto.replace(/^\s*agendar\s*:\s*/i, '');
  const partes = semPrefixo.split(',');
  if (partes.length !== 2 && partes.length !== 3) return null;

  const nome = partes[0].trim();
  const dataHora = partes[1].trim();
  const procedimento = partes[2]?.trim() || null;
  if (!nome) return null;

  const m = dataHora.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;

  const [, diaStr, mesStr, anoStr, horaStr, minStr] = m;
  const dia = parseInt(diaStr, 10);
  const mes = parseInt(mesStr, 10);
  const ano = anoStr ? parseInt(anoStr, 10) : new Date().getFullYear();
  const hora = parseInt(horaStr, 10);
  const min = parseInt(minStr, 10);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || min > 59) return null;

  const data = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  const horaFmt = `${String(hora).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  return { nome, data, hora: horaFmt, procedimento };
}

function fmtDataBR(data: string): string {
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}

const DIAS_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

function fmtDiaSemana(data: string): string {
  return DIAS_SEMANA[new Date(`${data}T12:00:00`).getDay()];
}

// Aceita DD/MM ou DD/MM/AAAA (sem hora) — usado pelos comandos de consultar
// e confirmar agenda de um dia.
function parseDataSimples(texto: string): string | null {
  const m = texto.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!m) return null;
  const [, diaStr, mesStr, anoStr] = m;
  const dia = parseInt(diaStr, 10);
  const mes = parseInt(mesStr, 10);
  const ano = anoStr ? parseInt(anoStr, 10) : new Date().getFullYear();
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

async function estaAutorizado(
  adminClient: ReturnType<typeof createClient>,
  clinicaId: string,
  numeroRemetente: string,
): Promise<boolean> {
  const { data: config } = await adminClient
    .from('config_clinica')
    .select('whatsapp_numeros_autorizados')
    .eq('clinica_id', clinicaId)
    .maybeSingle();

  const autorizados = (config?.whatsapp_numeros_autorizados || '')
    .split(',')
    .map((n: string) => soDigitos(n))
    .filter(Boolean);

  return autorizados.some((n: string) => numerosBatem(n, numeroRemetente));
}

function msgConfirmacaoConsulta(
  consulta: { nome: string; data: string; hora: string; procedimento: string | null },
  nomeClinica: string,
): string {
  const primeiroNome = consulta.nome.split(' ')[0];
  const procTexto = consulta.procedimento ? `Procedimento: ${consulta.procedimento}\n\n` : '';
  return (
    `Olá, ${primeiroNome}! 😊\n\n` +
    `Lembrando que você tem consulta ${fmtDiaSemana(consulta.data)}, dia ${fmtDataBR(consulta.data)} às ${consulta.hora}h na clínica da ${nomeClinica}.\n\n` +
    `${procTexto}Confirma sua presença? ✅\n\nTe esperamos! 💚`
  );
}

async function processarComandoListarAgenda(
  adminClient: ReturnType<typeof createClient>,
  clinicaId: string,
  instanciaNome: string,
  numeroRemetente: string,
  texto: string,
) {
  if (!(await estaAutorizado(adminClient, clinicaId, numeroRemetente))) return;

  const dataDigitada = texto.replace(/^\s*agenda\s*:\s*/i, '').trim();
  const dataAlvo = parseDataSimples(dataDigitada);
  if (!dataAlvo) {
    await enviarTexto(
      instanciaNome,
      numeroRemetente,
      'Não entendi a data. Use: agenda: DD/MM\n\nExemplo: agenda: 18/09',
    );
    return;
  }

  const { data: consultas } = await adminClient
    .from('agenda')
    .select('nome, hora, procedimento, status')
    .eq('clinica_id', clinicaId)
    .eq('data', dataAlvo)
    .neq('status', 'cancelado')
    .order('hora', { ascending: true });

  if (!consultas || !consultas.length) {
    await enviarTexto(
      instanciaNome,
      numeroRemetente,
      `Nenhuma consulta agendada pra ${fmtDataBR(dataAlvo)}.`,
    );
    return;
  }

  const lista = consultas
    .map((c: any) => `${c.hora.slice(0, 5)} — ${c.nome}${c.procedimento ? ' (' + c.procedimento + ')' : ''}`)
    .join('\n');

  await enviarTexto(
    instanciaNome,
    numeroRemetente,
    `📅 Agenda de ${fmtDataBR(dataAlvo)} (${consultas.length}):\n\n${lista}\n\n` +
      `Pra mandar confirmação pra todo mundo desse dia, mande: confirmar agenda: ${dataDigitada}`,
  );
}

async function processarComandoConfirmarAgenda(
  adminClient: ReturnType<typeof createClient>,
  clinicaId: string,
  instanciaNome: string,
  numeroRemetente: string,
  texto: string,
) {
  if (!(await estaAutorizado(adminClient, clinicaId, numeroRemetente))) return;

  const dataAlvo = parseDataSimples(texto.replace(/^\s*confirmar\s+agenda\s*:\s*/i, ''));
  if (!dataAlvo) {
    await enviarTexto(
      instanciaNome,
      numeroRemetente,
      'Não entendi a data. Use: confirmar agenda: DD/MM\n\nExemplo: confirmar agenda: 18/09',
    );
    return;
  }

  const { data: consultas } = await adminClient
    .from('agenda')
    .select('nome, hora, telefone, procedimento')
    .eq('clinica_id', clinicaId)
    .eq('data', dataAlvo)
    .neq('status', 'cancelado')
    .order('hora', { ascending: true });

  if (!consultas || !consultas.length) {
    await enviarTexto(
      instanciaNome,
      numeroRemetente,
      `Nenhuma consulta agendada pra ${fmtDataBR(dataAlvo)} — nada pra confirmar.`,
    );
    return;
  }

  const { data: clinicaConfig } = await adminClient
    .from('config_clinica')
    .select('nome')
    .eq('clinica_id', clinicaId)
    .maybeSingle();
  const nomeClinica = clinicaConfig?.nome || 'clínica';

  let enviadas = 0;
  let semTelefone = 0;
  for (const c of consultas as any[]) {
    const tel = soDigitos(c.telefone || '');
    if (!tel) {
      semTelefone++;
      continue;
    }
    await enviarTexto(instanciaNome, tel, msgConfirmacaoConsulta({ ...c, data: dataAlvo }, nomeClinica));
    enviadas++;
    await new Promise((r) => setTimeout(r, 1200));
  }

  await enviarTexto(
    instanciaNome,
    numeroRemetente,
    `✅ Confirmação enviada pra ${enviadas} paciente(s) de ${fmtDataBR(dataAlvo)}` +
      (semTelefone ? `, ${semTelefone} sem telefone cadastrado` : '') +
      '.',
  );
}

async function processarComandoAgendar(
  adminClient: ReturnType<typeof createClient>,
  clinicaId: string,
  instanciaNome: string,
  numeroRemetente: string,
  texto: string,
) {
  if (!(await estaAutorizado(adminClient, clinicaId, numeroRemetente))) return;

  const comando = parseComandoAgendar(texto);
  if (!comando) {
    await enviarTexto(instanciaNome, numeroRemetente, MSG_FORMATO);
    return;
  }

  const { data: exatos } = await adminClient
    .from('pacientes')
    .select('id, nome, telefone')
    .eq('clinica_id', clinicaId)
    .ilike('nome', comando.nome);

  let candidatos = exatos || [];
  if (!candidatos.length) {
    const { data: parciais } = await adminClient
      .from('pacientes')
      .select('id, nome, telefone')
      .eq('clinica_id', clinicaId)
      .ilike('nome', `%${comando.nome}%`);
    candidatos = parciais || [];
  }

  if (!candidatos.length) {
    await enviarTexto(
      instanciaNome,
      numeroRemetente,
      `Não encontrei nenhum paciente chamado "${comando.nome}". Confira o nome cadastrado no sistema e tente de novo.`,
    );
    return;
  }

  if (candidatos.length > 1) {
    const lista = candidatos
      .map((p: any) => `• ${p.nome}${p.telefone ? ' (' + p.telefone + ')' : ''}`)
      .join('\n');
    await enviarTexto(
      instanciaNome,
      numeroRemetente,
      `Encontrei mais de um paciente com esse nome:\n${lista}\n\nMande o comando de novo com o nome completo exatamente como está cadastrado.`,
    );
    return;
  }

  const paciente = candidatos[0] as { id: string; nome: string; telefone: string | null };

  // Não deixa marcar em cima de uma consulta que já existe no mesmo
  // horário — avisa quem já está agendado em vez de sobrepor silenciosamente.
  const { data: conflito } = await adminClient
    .from('agenda')
    .select('nome')
    .eq('clinica_id', clinicaId)
    .eq('data', comando.data)
    .eq('hora', comando.hora)
    .neq('status', 'cancelado')
    .limit(1)
    .maybeSingle();

  if (conflito) {
    await enviarTexto(
      instanciaNome,
      numeroRemetente,
      `⚠️ Já existe uma consulta marcada em ${fmtDataBR(comando.data)} às ${comando.hora}, com ${conflito.nome}. Não agendei — escolha outro horário ou confira o horário certo.`,
    );
    return;
  }

  const { error: erroAgenda } = await adminClient.from('agenda').insert({
    clinica_id: clinicaId,
    paciente_id: paciente.id,
    nome: paciente.nome,
    telefone: paciente.telefone,
    procedimento: comando.procedimento,
    data: comando.data,
    hora: comando.hora,
    status: 'agendado',
    origem: 'whatsapp',
  });

  if (erroAgenda) {
    console.error('[agendar-whatsapp]', erroAgenda);
    await enviarTexto(
      instanciaNome,
      numeroRemetente,
      'Deu erro ao tentar agendar. Tente novamente pelo sistema ou fale com o suporte.',
    );
    return;
  }

  const procTexto = comando.procedimento ? ` (${comando.procedimento})` : '';
  await enviarTexto(
    instanciaNome,
    numeroRemetente,
    `✅ Consulta agendada: ${paciente.nome} — ${fmtDataBR(comando.data)} às ${comando.hora}${procTexto}`,
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Segredo compartilhado opcional — se EVOLUTION_WEBHOOK_SECRET estiver
    // configurado como secret do projeto, exige que a Evolution o envie de
    // volta (header x-webhook-secret ou ?secret= na URL do webhook).
    const segredoEsperado = Deno.env.get('EVOLUTION_WEBHOOK_SECRET');
    if (segredoEsperado) {
      const url = new URL(req.url);
      const recebido = req.headers.get('x-webhook-secret') || url.searchParams.get('secret');
      if (recebido !== segredoEsperado) {
        return jsonResponse({ error: 'Não autorizado.' }, 401);
      }
    }

    const body = await req.json();
    const evento = String(body?.event || '').toLowerCase().replace(/_/g, '.');
    if (evento !== 'messages.upsert') {
      return jsonResponse({ ok: true, ignorado: true });
    }

    const instanciaNome = body?.instance;
    if (!instanciaNome) {
      return jsonResponse({ error: 'Evento sem instância.' }, 400);
    }

    // A Evolution pode mandar `data` como objeto único ou como array,
    // dependendo da versão/configuração.
    const itens = Array.isArray(body?.data) ? body.data : [body?.data].filter(Boolean);
    if (!itens.length) {
      return jsonResponse({ ok: true, semDados: true });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: instancia, error: instanciaError } = await adminClient
      .from('whatsapp_instancias')
      .select('clinica_id')
      .eq('instancia_nome', instanciaNome)
      .maybeSingle();
    if (instanciaError || !instancia?.clinica_id) {
      return jsonResponse({ error: 'Instância não cadastrada.' }, 404);
    }

    const linhas = itens
      .map((item: Record<string, any>) => {
        const messageId = item?.key?.id;
        if (!messageId) return null;
        // Só conversas individuais: grupos (@g.us) e status/broadcast são
        // conversa pessoal do número da clínica, não têm relação com paciente
        // e não devem ser armazenados (LGPD / minimização de dados).
        const jid = String(item?.key?.remoteJid || '');
        if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return null;
        return {
          clinica_id: instancia.clinica_id,
          instancia_nome: instanciaNome,
          message_id: messageId,
          remote_jid: item?.key?.remoteJid || null,
          texto: extrairTexto(item?.message) || null,
          from_me: !!item?.key?.fromMe,
          payload_bruto: item,
        };
      })
      .filter(Boolean);

    if (!linhas.length) {
      return jsonResponse({ ok: true, semMessageId: true });
    }

    // Idempotente: duplicata por message_id é ignorada em vez de dar erro.
    // O upsert com ignoreDuplicates só devolve as linhas realmente NOVAS —
    // é assim que garantimos que um comando "agendar:" só roda uma vez,
    // mesmo se a Evolution reenviar o mesmo evento (evita agendamento em
    // duplicidade).
    const { data: gravadas, error: insertError } = await adminClient
      .from('whatsapp_mensagens_recebidas')
      .upsert(linhas, { onConflict: 'message_id', ignoreDuplicates: true })
      .select('remote_jid, texto');

    if (insertError) {
      return jsonResponse({ error: insertError.message }, 500);
    }

    // Comandos por WhatsApp: mensagem de/para um número autorizado.
    // Não filtra por from_me porque o uso normal é a própria clínica
    // mandando o comando pra si mesma (chat "Você" no WhatsApp) — nesse
    // caso a mensagem sempre vem como from_me: true, mesmo sendo um comando
    // novo. Quem trava isso é a lista de números autorizados dentro de
    // cada handler (estaAutorizado).
    for (const linha of gravadas || []) {
      const texto = (linha.texto || '').trim();
      const numeroRemetente = soDigitos((linha.remote_jid || '').split('@')[0]);
      if (!numeroRemetente) continue;

      if (/^confirmar\s+agenda\s*:/i.test(texto)) {
        await processarComandoConfirmarAgenda(adminClient, instancia.clinica_id, instanciaNome, numeroRemetente, texto);
      } else if (/^agenda\s*:/i.test(texto)) {
        await processarComandoListarAgenda(adminClient, instancia.clinica_id, instanciaNome, numeroRemetente, texto);
      } else if (/^agendar\s*:/i.test(texto)) {
        await processarComandoAgendar(adminClient, instancia.clinica_id, instanciaNome, numeroRemetente, texto);
      }
    }

    return jsonResponse({ ok: true, gravadas: linhas.length });
  } catch (e) {
    return jsonResponse({ error: String(e?.message || e) }, 500);
  }
});
