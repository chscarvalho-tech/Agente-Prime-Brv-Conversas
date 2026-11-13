// Motor do agente: WhatsApp (WA-AKG) → memória → CRM → Claude Code → WhatsApp + CRM.
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');
export const ehSimulacao = (jid) => String(jid).startsWith('sim:');

const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function dentroDoHorario(horario, agora = new Date()) {
  if (!horario) return true;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: horario.fuso || 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(agora).map((x) => [x.type, x.value]));
  const hhmm = `${p.hour}:${p.minute}`;
  return horario.dias.includes(DIAS[p.weekday]) && hhmm >= horario.inicio && hhmm < horario.fim;
}

function agoraTexto(fuso = 'America/Sao_Paulo') {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date());
}

/** Texto que representa o conteúdo de um evento de mensagem do WA-AKG. */
export function descreverConteudo(d) {
  const texto = (d.content || '').trim();
  const legenda = (d.caption || '').trim();
  switch (d.type) {
    case 'TEXT': case undefined: return texto;
    case 'IMAGE': return `[imagem]${legenda ? ' ' + legenda : ''}`;
    case 'VIDEO': return `[vídeo]${legenda ? ' ' + legenda : ''}`;
    case 'AUDIO': return '[áudio: o lead mandou uma mensagem de voz que não pode ser ouvida aqui; peça para escrever]';
    case 'DOCUMENT': return `[documento: ${texto || 'arquivo'}]${legenda ? ' ' + legenda : ''}`;
    case 'STICKER': return '[figurinha]';
    case 'LOCATION': return `[localização: ${texto}]`;
    case 'CONTACT': return `[contato compartilhado: ${texto}]`;
    default: return texto || `[${String(d.type).toLowerCase()}]`;
  }
}

export class Motor {
  constructor({ memoria, config, cerebro, crm, wa, log = console, crmEmSimulacao = false }) {
    Object.assign(this, { memoria, config, cerebro, crm, wa, log, crmEmSimulacao });
    this.timers = new Map();
    this.ocupados = new Set();
    this.repetir = new Set();
    this.idsEnviados = new Set();
    this.pendentes = []; // envios nossos aguardando o eco "message.sent"
  }

  // ================= entrada =================

  async receberWebhook(payload) {
    const { event, data } = payload || {};
    if (!data) return;
    if (event === 'message.received') return this.mensagemRecebida(data);
    if (event === 'message.sent') return this.mensagemEnviada(data);
  }

  _ehDaEquipe(telefone) {
    const ag = this.config.agente();
    const et = this.config.etapas();
    const numeros = [...(ag.numeros_ignorados ?? []), ...(et.destinos ?? []).map((d) => d.whatsapp)].map(soDigitos).filter(Boolean);
    return numeros.some((n) => telefone.endsWith(n) || n.endsWith(telefone));
  }

  /** Mensagem do lead. Devolve a conversa (ou null se ignorada). */
  mensagemRecebida(d) {
    if (d.key?.fromMe) return null;
    if (d.isGroup || (d.chatType && d.chatType !== 'PERSONAL')) return null;
    const jid = d.from || d.key?.remoteJid;
    if (!jid || jid.endsWith('@g.us') || jid.endsWith('@newsletter') || jid === 'status@broadcast') return null;
    const telefone = soDigitos(jid.split('@')[0].split(':')[0]);
    if (!ehSimulacao(jid) && this._ehDaEquipe(telefone)) return null;

    let conversa = this.memoria.conversaPorJid(jid);
    const nova = !conversa;
    if (nova) {
      conversa = this.memoria.criarConversa({ jid, telefone, nome_whatsapp: d.pushName, etapa: this.config.etapas().etapa_inicial });
      this.memoria.evento(conversa.id, 'conversa_criada', {});
    }
    const id = this.memoria.inserirMensagem({ conversa_id: conversa.id, direcao: 'in', autor: 'lead', texto: descreverConteudo(d), wa_id: d.key?.id ?? null });
    if (!id) return conversa; // reentrega do mesmo webhook
    if (d.pushName && d.pushName !== conversa.nome_whatsapp) conversa = this.memoria.atualizar(conversa.id, { nome_whatsapp: d.pushName });

    // O lead entra no CRM assim que chega, sem esperar a resposta da IA.
    if (nova) this.garantirNoCrm(conversa).catch(() => {});
    this.agendar(conversa.id, (this.config.agente().aguardar_segundos ?? 8) * 1000);
    return conversa;
  }

  /** Eco de mensagem enviada pelo número. Se não foi o agente, foi alguém da equipe pelo celular. */
  async mensagemEnviada(d) {
    const jid = d.key?.remoteJid || d.from;
    const waId = d.key?.id ?? null;
    if (!jid || jid.endsWith('@g.us') || ehSimulacao(jid)) return;
    const texto = descreverConteudo(d);
    if (this._ehNosso(jid, waId, texto)) return;
    await dormir(4000); // o eco pode chegar antes de a API devolver o id do envio
    if (this._ehNosso(jid, waId, texto)) return;
    const conversa = this.memoria.conversaPorJid(jid);
    if (!conversa) return;
    const id = this.memoria.inserirMensagem({ conversa_id: conversa.id, direcao: 'out', autor: 'equipe', texto, wa_id: waId });
    if (id) this.equipeAssumiu(conversa, 'celular');
  }

  equipeAssumiu(conversa, via) {
    if (conversa.modo === 'equipe') return;
    const horas = Number(this.config.agente().pausa_humano_horas ?? 12);
    const ate = horas > 0 ? Date.now() + horas * 3600e3 : null;
    this.memoria.atualizar(conversa.id, { modo: 'equipe', pausado_ate: ate });
    this.memoria.evento(conversa.id, 'equipe_assumiu', { via, retoma_em: ate });
  }

  _ehNosso(jid, waId, texto) {
    if (waId && this.idsEnviados.has(waId)) return true;
    const agora = Date.now();
    this.pendentes = this.pendentes.filter((p) => p.ate > agora);
    const achou = this.pendentes.find((p) => p.jid === jid && p.texto.trim() === texto.trim());
    if (achou && waId) this.idsEnviados.add(waId);
    return Boolean(achou);
  }

  // ================= CRM =================

  _leadParaCrm(conversa) {
    const et = this.config.etapas();
    const etapa = et.etapas.find((e) => e.id === conversa.etapa);
    const campos = {};
    for (const c of et.campos ?? []) {
      const v = conversa.dados?.[c.id];
      if (v && c.campo_crm && c.id !== 'nome') campos[c.campo_crm] = v;
    }
    return {
      telefone: conversa.telefone,
      nome: conversa.dados?.nome || conversa.nome_whatsapp || `WhatsApp ${conversa.telefone}`,
      etapa: conversa.etapa,
      etapa_crm: etapa?.valor_crm ?? '',
      campos,
      dados: conversa.dados || {},
      resumo: conversa.resumo || '',
      origem: 'WhatsApp',
    };
  }

  _usaCrm(conversa) {
    return !ehSimulacao(conversa.jid) || this.crmEmSimulacao;
  }

  /** Garante que o lead existe no CRM (busca pelo telefone; se não achar, cria). */
  async garantirNoCrm(conversa) {
    if (conversa.crm_id || !this._usaCrm(conversa)) return conversa;
    // Uma criação por vez para cada conversa: evita lead duplicado se o CRM estiver lento.
    this.criandoNoCrm ??= new Map();
    if (!this.criandoNoCrm.has(conversa.id)) {
      this.criandoNoCrm.set(conversa.id, this._criarNoCrm(conversa).finally(() => this.criandoNoCrm.delete(conversa.id)));
    }
    return this.criandoNoCrm.get(conversa.id);
  }

  async _criarNoCrm(conversa) {
    try {
      let crmId = await this.crm.buscarPorTelefone(conversa.telefone);
      let acao = 'crm_vinculado';
      if (!crmId) { crmId = await this.crm.criar(this._leadParaCrm(this.memoria.conversaPorId(conversa.id))); acao = 'crm_criado'; }
      this.memoria.evento(conversa.id, acao, { crm_id: crmId });
      return this.memoria.atualizar(conversa.id, { crm_id: crmId, crm_pendente: 0 });
    } catch (e) {
      this.log.error('[crm] falha ao criar/buscar lead:', e.message);
      this.memoria.evento(conversa.id, 'erro_crm', { op: 'criar', erro: String(e.message).slice(0, 400) });
      return this.memoria.atualizar(conversa.id, { crm_pendente: 1 });
    }
  }

  /** Envia etapa, campos e resumo ao CRM, e uma nota se houver. Em falha, marca para tentar de novo. */
  async sincronizarCrm(conversaId, notas = []) {
    let c = this.memoria.conversaPorId(conversaId);
    if (!this._usaCrm(c)) return;
    c = await this.garantirNoCrm(c);
    if (!c.crm_id) return;
    try {
      await this.crm.atualizar(c.crm_id, this._leadParaCrm(c));
      // Uma nota por resposta, com tudo o que aconteceu nela.
      const texto = notas.filter(Boolean).join('\n');
      if (texto) await this.crm.registrarNota(c.crm_id, `Agente WhatsApp: ${texto}`);
      this.memoria.atualizar(c.id, { crm_pendente: 0 });
    } catch (e) {
      this.log.error('[crm] falha ao atualizar lead:', e.message);
      this.memoria.evento(c.id, 'erro_crm', { op: 'atualizar', erro: String(e.message).slice(0, 400) });
      this.memoria.atualizar(c.id, { crm_pendente: 1 });
    }
  }

  async reenviarPendentesCrm() {
    let n = 0;
    for (const c of this.memoria.conversasComCrmPendente()) { await this.sincronizarCrm(c.id); n++; }
    return n;
  }

  // ================= processamento =================

  agendar(conversaId, ms) {
    clearTimeout(this.timers.get(conversaId));
    this.timers.set(conversaId, setTimeout(() => {
      this.timers.delete(conversaId);
      this.processar(conversaId).catch((e) => this.log.error('[motor] erro na conversa', conversaId, e));
    }, ms));
  }

  async processar(conversaId) {
    if (this.ocupados.has(conversaId)) { this.repetir.add(conversaId); return; }
    this.ocupados.add(conversaId);
    try {
      await this._processar(conversaId);
    } finally {
      this.ocupados.delete(conversaId);
      if (this.repetir.delete(conversaId)) this.agendar(conversaId, 300);
    }
  }

  async _processar(conversaId) {
    let conversa = this.memoria.conversaPorId(conversaId);
    if (!conversa) return;
    const agente = this.config.agente();
    const etapas = this.config.etapas();
    const novas = this.memoria.mensagensApos(conversa.id, conversa.ultimo_in_respondido);
    if (!novas.length) return;
    const marcar = (extra = {}) => this.memoria.atualizar(conversa.id, { ultimo_in_respondido: novas.at(-1).id, ...extra });
    const sim = ehSimulacao(conversa.jid);

    if (conversa.optout) return marcar();
    if (!agente.ativo && !sim) return marcar();
    if (conversa.modo === 'equipe') {
      if (conversa.pausado_ate && Date.now() > conversa.pausado_ate) {
        this.memoria.evento(conversa.id, 'agente_retomou', { motivo: 'fim da pausa' });
        conversa = this.memoria.atualizar(conversa.id, { modo: 'agente', pausado_ate: null });
      } else return marcar();
    }
    if (etapas.etapas.find((e) => e.id === conversa.etapa)?.final) return marcar();

    const textoNovo = novas.map((m) => m.texto).join(' ').trim().toLowerCase().replace(/[.!]+$/, '');
    if ((agente.palavras_optout ?? []).some((p) => textoNovo === String(p).toLowerCase())) {
      marcar({ optout: 1 });
      this.memoria.evento(conversa.id, 'optout', { via: 'palavra-chave' });
      if (agente.mensagem_optout) await this.enviar(conversa, [agente.mensagem_optout]);
      await this.sincronizarCrm(conversa.id, ['Lead pediu para não receber mais mensagens no WhatsApp.']);
      return;
    }

    conversa = await this.garantirNoCrm(conversa);
    const historico = this.memoria.mensagens(conversa.id, agente.historico_max_mensagens ?? 40);
    const contexto = {
      agora: agoraTexto(agente.horario?.fuso),
      dentroHorario: dentroDoHorario(agente.horario),
      mensagemForaHorario: agente.mensagem_fora_horario ?? '',
      lacunas: this.memoria.lacunasDaConversa(conversa.id).map((l) => l.pergunta),
    };

    let r;
    try {
      r = await this.cerebro.pensar({ agente, etapas, conhecimento: this.config.conhecimento(), conversa, historico, contexto });
    } catch (e) {
      this.log.error('[motor] falha no Claude Code:', e.message);
      this.memoria.evento(conversa.id, 'erro_ia', { erro: String(e.message).slice(0, 500) });
      marcar();
      return this._falhaParaEquipe(conversa, agente, `erro no Claude Code: ${String(e.message).slice(0, 200)}`);
    }
    this.memoria.registrarUso(conversa.id, r.uso);
    marcar();
    await this.aplicar(conversa, r.saida, { agente, etapas });
  }

  async _falhaParaEquipe(conversa, agente, motivo) {
    if (agente.mensagem_erro) await this.enviar(conversa, [agente.mensagem_erro]);
    const atual = this.memoria.atualizar(conversa.id, { modo: 'equipe', pausado_ate: null });
    this.memoria.evento(conversa.id, 'transferido', { destino: null, motivo });
    await this.notificarDestino(atual, null, motivo);
    await this.sincronizarCrm(conversa.id, [`Agente não conseguiu responder (${motivo}). Conversa passou para a equipe.`]);
  }

  async aplicar(conversa, s, { agente, etapas }) {
    const ids = new Set(etapas.etapas.map((e) => e.id));
    const dados = { ...conversa.dados };
    for (const [k, v] of Object.entries(s.dados || {})) if (typeof v === 'string' && v.trim()) dados[k] = v.trim();

    let etapa = ids.has(s.etapa) ? s.etapa : conversa.etapa;
    if (s.acao === 'transferir' && ids.has('encaminhado')) etapa = 'encaminhado';
    if (s.acao === 'desqualificar' && ids.has('desqualificado')) etapa = 'desqualificado';

    const patch = { dados, etapa, resumo: s.resumo?.trim() || conversa.resumo };
    const motivo = s.motivo?.trim().replace(/[.\s]+$/, '');
    const notas = [];
    if (etapa !== conversa.etapa) {
      const nome = (id) => etapas.etapas.find((e) => e.id === id)?.nome ?? id;
      this.memoria.evento(conversa.id, 'etapa', { de: conversa.etapa, para: etapa, motivo });
      notas.push(`Etapa: ${nome(conversa.etapa)} → ${nome(etapa)}${motivo ? ` (${motivo})` : ''}.`);
    }
    if (s.nota_crm?.trim()) notas.push(s.nota_crm.trim());
    if (s.lacuna?.trim() && this.memoria.lacuna(conversa.id, s.lacuna.trim())) {
      notas.push(`Pergunta sem resposta na base de conhecimento: "${s.lacuna.trim()}"`);
    }
    let atual = this.memoria.atualizar(conversa.id, patch);

    const baloes = (s.mensagens || []).map((t) => t.trim()).filter(Boolean).slice(0, agente.max_baloes ?? 3);
    await this.enviar(atual, baloes);

    let destino = null;
    if (s.acao === 'transferir') {
      destino = (etapas.destinos ?? []).find((d) => d.id === s.destino_id) ?? (etapas.destinos ?? [])[0] ?? null;
      atual = this.memoria.atualizar(conversa.id, { modo: 'equipe', pausado_ate: null, destino: destino?.id ?? null });
      this.memoria.evento(conversa.id, 'transferido', { destino: destino?.id ?? null, motivo: s.motivo });
      notas.push(`Transferido para ${destino?.nome ?? 'a equipe'}${motivo && etapa === conversa.etapa ? `: ${motivo}` : ''}.`);
    }
    if (s.acao === 'optout') {
      atual = this.memoria.atualizar(conversa.id, { optout: 1 });
      this.memoria.evento(conversa.id, 'optout', { via: 'ia' });
      notas.push('Lead pediu para não receber mais mensagens no WhatsApp.');
    }
    if (s.acao === 'desqualificar') this.memoria.evento(conversa.id, 'desqualificado', { motivo: s.motivo });

    await this.sincronizarCrm(conversa.id, notas);
    if (s.acao === 'transferir') await this.notificarDestino(this.memoria.conversaPorId(conversa.id), destino, s.motivo);
    return { ...s, etapa, dados };
  }

  // ================= saída =================

  async _enviarTexto(jid, texto) {
    this.pendentes.push({ jid, texto, ate: Date.now() + 120000 });
    const id = await this.wa.enviarTexto(jid, texto);
    if (id) this.idsEnviados.add(id);
    return id;
  }

  /** Envia balões com pausa de digitação e grava no histórico. */
  async enviar(conversa, textos, autor = 'agente') {
    const sim = ehSimulacao(conversa.jid);
    const agente = this.config.agente();
    for (const texto of textos) {
      let waId = null;
      if (!sim) {
        if (agente.simular_digitacao !== false && autor === 'agente') {
          await this.wa.digitando(conversa.jid);
          await dormir(Math.min(1000 + texto.length * 30, 6000));
        }
        try {
          waId = await this._enviarTexto(conversa.jid, texto);
        } catch (e) {
          this.log.error('[motor] falha ao enviar no WhatsApp:', e.message);
          this.memoria.evento(conversa.id, 'erro_envio', { erro: String(e.message).slice(0, 300) });
          continue;
        }
      }
      this.memoria.inserirMensagem({ conversa_id: conversa.id, direcao: 'out', autor, texto, wa_id: waId });
    }
  }

  montarAviso(conversa, motivo) {
    const et = this.config.etapas();
    const etapa = et.etapas.find((e) => e.id === conversa.etapa)?.nome || conversa.etapa;
    const dados = (et.campos ?? []).filter((c) => conversa.dados?.[c.id]).map((c) => `• ${c.rotulo}: ${conversa.dados[c.id]}`);
    return [
      '🔔 *Lead para a equipe (agente do WhatsApp)*',
      `*Nome:* ${conversa.dados?.nome || conversa.nome_whatsapp || '—'}`,
      `*WhatsApp:* +${conversa.telefone} → https://wa.me/${conversa.telefone}`,
      `*Etapa:* ${etapa}`,
      motivo ? `*Motivo:* ${motivo}` : null,
      conversa.resumo ? `*Resumo:* ${conversa.resumo}` : null,
      dados.length ? `*Dados:*\n${dados.join('\n')}` : null,
      conversa.crm_id ? `*Lead no CRM:* ${conversa.crm_id}` : '*CRM:* ainda não sincronizado',
    ].filter(Boolean).join('\n');
  }

  async notificarDestino(conversa, destino, motivo) {
    const d = destino ?? (this.config.etapas().destinos ?? [])[0];
    const numero = soDigitos(d?.whatsapp);
    if (!numero || ehSimulacao(conversa.jid)) return;
    try {
      await this._enviarTexto(`${numero}@s.whatsapp.net`, this.montarAviso(conversa, motivo));
    } catch (e) {
      this.memoria.evento(conversa.id, 'erro_envio', { erro: `aviso à equipe: ${String(e.message).slice(0, 300)}` });
    }
  }

  /** A equipe devolve a conversa ao agente (cli.js devolver). */
  devolverAoAgente(conversaId) {
    const c = this.memoria.conversaPorId(conversaId);
    if (!c) return null;
    const et = this.config.etapas();
    const patch = { modo: 'agente', pausado_ate: null };
    if (et.etapas.find((e) => e.id === c.etapa)?.final && c.etapa === 'encaminhado') {
      patch.etapa = et.etapas.some((e) => e.id === 'qualificado') ? 'qualificado' : et.etapa_inicial;
    }
    this.memoria.evento(c.id, 'agente_retomou', { motivo: 'devolvido pela equipe' });
    return this.memoria.atualizar(c.id, patch);
  }
}
