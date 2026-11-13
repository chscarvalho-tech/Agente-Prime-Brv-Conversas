import fs from 'node:fs';
import path from 'node:path';

/** Troca ${VAR} pelo valor do ambiente (.env), em qualquer string do objeto. */
export function interpolarEnv(valor, env = process.env) {
  if (typeof valor === 'string') return valor.replace(/\$\{(\w+)\}/g, (_, k) => env[k] ?? '');
  if (Array.isArray(valor)) return valor.map((v) => interpolarEnv(v, env));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, interpolarEnv(v, env)]));
  }
  return valor;
}

export class Config {
  constructor(raiz) {
    this.raiz = raiz;
  }

  _json(nome) {
    const arq = path.join(this.raiz, 'config', nome);
    try {
      return JSON.parse(fs.readFileSync(arq, 'utf8'));
    } catch (e) {
      throw new Error(`Não consegui ler config/${nome}: ${e.message}`);
    }
  }

  agente() { return this._json('agente.json'); }
  etapas() { return this._json('etapas.json'); }
  crm() { return interpolarEnv(this._json('crm.json')); }

  /** Todos os .md de conhecimento/, em ordem de nome. */
  conhecimento() {
    const dir = path.join(this.raiz, 'conhecimento');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => ({ arquivo: f, texto: fs.readFileSync(path.join(dir, f), 'utf8').trim() }));
  }

  /** Confere a configuração e devolve { erros, avisos }. */
  validar() {
    const erros = [];
    const avisos = [];
    let ag, et, crm;
    try { ag = this.agente(); } catch (e) { erros.push(e.message); }
    try { et = this.etapas(); } catch (e) { erros.push(e.message); }
    try { crm = this.crm(); } catch (e) { erros.push(e.message); }

    if (ag) {
      if (!ag.nome_agente) erros.push('agente.json: falta nome_agente');
      if (!ag.empresa) erros.push('agente.json: falta empresa');
      const h = ag.horario;
      if (h && (!Array.isArray(h.dias) || !/^\d\d:\d\d$/.test(h.inicio) || !/^\d\d:\d\d$/.test(h.fim))) {
        erros.push('agente.json: horario precisa de dias [0-6], inicio e fim no formato HH:MM');
      }
      if (ag.claude?.usar_chave_api && !process.env.ANTHROPIC_API_KEY) {
        erros.push('agente.json: claude.usar_chave_api = true, mas ANTHROPIC_API_KEY está vazio no .env');
      }
    }

    if (et) {
      const ids = new Set((et.etapas ?? []).map((e) => e.id));
      if (!ids.size) erros.push('etapas.json: nenhuma etapa');
      if (!ids.has(et.etapa_inicial)) erros.push(`etapas.json: etapa_inicial "${et.etapa_inicial}" não existe em etapas`);
      for (const e of et.etapas ?? []) {
        if (!e.id || !e.nome) erros.push('etapas.json: toda etapa precisa de id e nome');
        if (!e.valor_crm) avisos.push(`etapas.json: etapa "${e.id}" sem valor_crm (não será gravada no CRM)`);
      }
      if (!(et.etapas ?? []).some((e) => e.final)) avisos.push('etapas.json: nenhuma etapa marcada como final (onde o agente para)');
      if (!ids.has('encaminhado')) avisos.push('etapas.json: sem etapa "encaminhado"; transferências mantêm a etapa atual');
      const campos = new Set();
      for (const c of et.campos ?? []) {
        if (!c.id || !c.rotulo) erros.push('etapas.json: todo campo precisa de id e rotulo');
        if (campos.has(c.id)) erros.push(`etapas.json: campo repetido "${c.id}"`);
        campos.add(c.id);
      }
      const destinos = et.destinos ?? [];
      if (!destinos.length) avisos.push('etapas.json: nenhum destino; transferências não avisam ninguém no WhatsApp');
      for (const d of destinos) if (!String(d.whatsapp ?? '').replace(/\D/g, '')) avisos.push(`etapas.json: destino "${d.id}" sem WhatsApp`);
      if (JSON.stringify(et).includes('exemplo A')) avisos.push('etapas.json: ainda tem valores de MODELO ("exemplo A"). Rode a entrevista de instalação.');
    }

    if (crm) {
      const modos = ['http', 'supabase', 'modulo', 'nenhum'];
      if (!modos.includes(crm.modo)) erros.push(`crm.json: modo deve ser um de ${modos.join(', ')}`);
      if (crm.modo === 'nenhum') avisos.push('crm.json: modo "nenhum": os leads ficam só na memória local, nada vai para o CRM');
      if (crm.modo === 'http' && !crm.http?.base_url) erros.push('crm.json: modo http sem base_url (CRM_URL no .env?)');
      if (crm.modo === 'supabase' && (!crm.supabase?.url || !crm.supabase?.chave)) erros.push('crm.json: modo supabase sem url ou chave (CRM_URL / CRM_TOKEN no .env?)');
      if (crm.modo === 'modulo' && !fs.existsSync(path.join(this.raiz, 'crm', 'adaptador.js'))) erros.push('crm.json: modo modulo, mas crm/adaptador.js não existe');
    }

    const conh = this.conhecimento();
    if (!conh.length) erros.push('conhecimento/: nenhum arquivo .md');
    const tamanho = conh.reduce((s, c) => s + c.texto.length, 0);
    if (tamanho > 120000) avisos.push(`conhecimento/: ${Math.round(tamanho / 1000)} mil caracteres; cada resposta gasta mais limite do Claude. Considere enxugar.`);
    if (conh.some((c) => c.texto.includes('[PREENCHER'))) avisos.push('conhecimento/: ainda há trechos [PREENCHER]. Rode a entrevista de instalação.');

    for (const v of ['WAAKG_URL', 'WAAKG_API_KEY', 'WAAKG_SESSION']) if (!process.env[v]) avisos.push(`.env: ${v} vazio (necessário para ligar no WhatsApp)`);
    if (!process.env.WEBHOOK_SECRET) avisos.push('.env: WEBHOOK_SECRET vazio');
    if (process.env.PUBLIC_URL && !/^https:\/\//.test(process.env.PUBLIC_URL)) avisos.push('.env: PUBLIC_URL deveria ser https (o WA-AKG recusa http/localhost)');

    return { erros, avisos };
  }
}
