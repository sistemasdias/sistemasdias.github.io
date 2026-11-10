// Uma "rodada" da fila de divulgação: no máximo UMA mensagem por clínica.
// Recebe o banco (`db`, cliente Supabase com service role) e a função que de fato envia
// (`enviar`), para poder rodar em teste com banco e envio falsos: tests/divulgacao.test.js.
//
// Ordem das travas, da mais barata à mais cara — qualquer uma que falhe, não envia:
//   clínica com o recurso ligado → dentro do horário → abaixo do limite do dia →
//   trava de concorrência (ninguém mais pegou esta rodada) → paciente não pediu para sair.

import {
  MAX_ERROS_SEGUIDOS, dentroDaJanela, inicioDoDia, montarTexto, proximaAbertura,
  sortearIntervaloSeg, umaPorClinica,
} from './fila.mjs';

export async function processarFila(db, enviar, agora = new Date(), sorteio = Math.random) {
  const resumo = { enviados: 0, erros: 0, pulados: 0, concluidas: 0, pausadas: 0, adiadas: 0, desligadas: 0 };

  const { data: prontas, error } = await db
    .from('divulgacoes')
    .select('*')
    .eq('status', 'enviando')
    .lte('proximo_envio_em', agora.toISOString());
  if (error) throw new Error(error.message);

  await Promise.all(umaPorClinica(prontas).map(async (d) => {
    try {
      await processarUma(db, enviar, d, agora, sorteio, resumo);
    } catch (e) {
      console.error('[divulgacao]', d.id, e?.message || e);
    }
  }));
  return resumo;
}

// Muda proximo_envio_em SÓ se ninguém mexeu desde que lemos a linha. Devolve true se conseguiu.
// É a trava de concorrência: duas chamadas ao mesmo tempo nunca enviam duas mensagens.
async function reservar(db, d, quando) {
  const { data } = await db
    .from('divulgacoes')
    .update({ proximo_envio_em: quando.toISOString() })
    .eq('id', d.id)
    .eq('status', 'enviando')
    .eq('proximo_envio_em', d.proximo_envio_em)
    .select('id');
  return !!(data && data.length);
}

async function restamPendentes(db, d) {
  const { data } = await db
    .from('divulgacao_envios')
    .select('id')
    .eq('divulgacao_id', d.id)
    .eq('status', 'pendente')
    .limit(1);
  return !!(data && data.length);
}

async function concluirSeAcabou(db, d, agora, resumo) {
  if (await restamPendentes(db, d)) return;
  await db.from('divulgacoes')
    .update({ status: 'concluida', concluido_em: agora.toISOString() })
    .eq('id', d.id).eq('status', 'enviando');
  resumo.concluidas++;
}

async function pausar(db, d, motivo, resumo) {
  await db.from('divulgacoes')
    .update({ status: 'pausada', motivo_pausa: motivo })
    .eq('id', d.id).eq('status', 'enviando');
  resumo.pausadas++;
}

async function processarUma(db, enviar, d, agora, sorteio, resumo) {
  // 1. A clínica está com a divulgação ligada?
  const { data: config } = await db
    .from('config_clinica').select('divulgacao_whatsapp').eq('clinica_id', d.clinica_id).maybeSingle();
  if (config?.divulgacao_whatsapp !== true) { resumo.desligadas++; return; }

  // 2. Horário permitido (segunda a sábado, dentro da janela)
  if (!dentroDaJanela(d, agora)) {
    if (await reservar(db, d, proximaAbertura(d, agora))) resumo.adiadas++;
    return;
  }

  // 3. Limite do dia — vale para a CLÍNICA (o risco de bloqueio é do número, não da divulgação)
  const { data: hoje } = await db
    .from('divulgacao_envios')
    .select('id')
    .eq('clinica_id', d.clinica_id)
    .eq('status', 'enviado')
    .gte('enviado_em', inicioDoDia(agora).toISOString());
  if ((hoje || []).length >= d.limite_dia) {
    if (await reservar(db, d, proximaAbertura(d, agora))) resumo.adiadas++;
    return;
  }

  // 4. Reserva a rodada já marcando quando será a próxima (intervalo sorteado)
  const proximo = new Date(agora.getTime() + sortearIntervaloSeg(d, sorteio()) * 1000);
  if (!(await reservar(db, d, proximo))) return;

  // 5. Próxima paciente da fila
  const { data: envio } = await db
    .from('divulgacao_envios')
    .select('*')
    .eq('divulgacao_id', d.id)
    .eq('status', 'pendente')
    .order('criado_em', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!envio) { await concluirSeAcabou(db, d, agora, resumo); return; }

  // 6. Pediu para não receber depois de entrar na lista? Pula sem enviar e sem gastar o intervalo.
  if (envio.paciente_id) {
    const { data: pac } = await db
      .from('pacientes').select('sem_divulgacao').eq('id', envio.paciente_id).maybeSingle();
    if (pac?.sem_divulgacao === true) {
      await db.from('divulgacao_envios')
        .update({ status: 'pulado', erro: 'Paciente pediu para não receber divulgação' })
        .eq('id', envio.id);
      await db.from('divulgacoes').update({ proximo_envio_em: agora.toISOString() })
        .eq('id', d.id).eq('status', 'enviando');
      resumo.pulados++;
      await concluirSeAcabou(db, d, agora, resumo);
      return;
    }
  }

  // 7. WhatsApp da clínica
  const { data: instancia } = await db
    .from('whatsapp_instancias')
    .select('instancia_nome')
    .eq('clinica_id', d.clinica_id)
    .eq('ativo', true)
    .order('criado_em', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!instancia?.instancia_nome) {
    await pausar(db, d, 'Nenhum WhatsApp conectado para esta clínica.', resumo);
    return;
  }

  // 8. Envia
  const texto = montarTexto(d.mensagem, envio.chamada);
  let r;
  try {
    r = await enviar({ instancia: instancia.instancia_nome, numero: envio.numero, texto, divulgacao: d });
  } catch (e) {
    r = { ok: false, erro: String(e?.message || e) };
  }

  if (r?.ok) {
    await db.from('divulgacao_envios')
      .update({ status: 'enviado', enviado_em: agora.toISOString(), evolution_message_id: r.id || null, erro: null })
      .eq('id', envio.id);
    if (d.erros_seguidos) await db.from('divulgacoes').update({ erros_seguidos: 0 }).eq('id', d.id);
    await db.from('whatsapp_mensagens_enviadas').insert({
      clinica_id: d.clinica_id,
      instancia_nome: instancia.instancia_nome,
      paciente_id: envio.paciente_id || null,
      numero: envio.numero,
      texto,
      evolution_message_id: r.id || null,
      status: 'enviado',
    });
    resumo.enviados++;
  } else {
    const erro = String(r?.erro || 'Falha ao enviar').slice(0, 300);
    await db.from('divulgacao_envios').update({ status: 'erro', erro }).eq('id', envio.id);
    const seguidos = (d.erros_seguidos || 0) + 1;
    resumo.erros++;
    if (seguidos >= MAX_ERROS_SEGUIDOS) {
      await db.from('divulgacoes').update({ erros_seguidos: seguidos }).eq('id', d.id);
      await pausar(db, d, `Pausada sozinha: ${seguidos} envios seguidos falharam. Último erro: ${erro}`, resumo);
      return;
    }
    await db.from('divulgacoes').update({ erros_seguidos: seguidos }).eq('id', d.id);
  }

  await concluirSeAcabou(db, d, agora, resumo);
}
