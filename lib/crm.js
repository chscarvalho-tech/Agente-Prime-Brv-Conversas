// Conector com o CRM da empresa. Quatro modos (config/crm.json):
//   http      → API REST do CRM, com rotas e corpos descritos no JSON
//   supabase  → CRM com banco Supabase (PostgREST), tabela e colunas descritas no JSON
//   modulo    → crm/adaptador.js, escrito na instalação quando o CRM não se encaixa nos dois acima
//   nenhum    → não grava em lugar nenhum (testes)
// Todos expõem a mesma interface: buscarPorTelefone, criar, atualizar, registrarNota.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function formatarTelefone(digitos, formato = 'digitos') {
  const d = String(digitos).replace(/\D/g, '');
  switch (formato) {
    case 'e164': return `+${d}`;
    case 'nacional': return d.startsWith('55') ? d.slice(2) : d; // DDD + número
    default: return d;
  }
}

/** Lê "a.b.0.c" dentro de um objeto. */
export function pegar(obj, caminho) {
  if (!caminho) return obj;
  return String(caminho).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Preenche um modelo de corpo/rota:
 *  - "{var}" sozinho vira o valor cru (mantém número/objeto);
 *  - "texto {var}" vira texto;
 *  - "$campos": true espalha os campos de qualificação mapeados para o CRM.
 */
export function preencherModelo(modelo, vars) {
  if (typeof modelo === 'string') {
    const so = modelo.match(/^\{(\w+)\}$/);
    if (so) return vars[so[1]] ?? null;
    return modelo.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
  }
  if (Array.isArray(modelo)) return modelo.map((m) => preencherModelo(m, vars));
  if (modelo && typeof modelo === 'object') {
    const saida = {};
    for (const [k, v] of Object.entries(modelo)) {
      if (k === '$campos') { if (v) Object.assign(saida, vars.campos ?? {}); continue; }
      const valor = preencherModelo(v, vars);
      if (valor !== null && valor !== '') saida[k] = valor;
    }
    return saida;
  }
  return modelo;
}

function rotaComVars(rota, vars) {
  return rota.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vars[k] == null ? '' : String(vars[k])));
}

async function chamar(url, { metodo = 'GET', cabecalhos = {}, corpo } = {}) {
  const res = await fetch(url, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...cabecalhos },
    body: corpo === undefined || metodo === 'GET' ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(20000),
  });
  const texto = await res.text();
  let json;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  if (!res.ok) throw new Error(`CRM ${metodo} ${new URL(url).pathname} → ${res.status}: ${String(texto).slice(0, 300)}`);
  return json;
}

// ---------------- modo http ----------------

class CrmHttp {
  constructor(cfg, formato) {
    this.c = cfg;
    this.formato = formato;
    this.base = String(cfg.base_url || '').replace(/\/+$/, '');
  }

  async _op(nome, vars) {
    const op = this.c[nome];
    if (!op) return undefined;
    const url = this.base + rotaComVars(op.caminho, vars);
    const corpo = op.corpo ? preencherModelo(op.corpo, vars) : undefined;
    const r = await chamar(url, { metodo: op.metodo || 'GET', cabecalhos: this.c.cabecalhos, corpo });
    return { resposta: r, id: op.id_no_resultado ? pegar(r, op.id_no_resultado) : undefined };
  }

  async buscarPorTelefone(tel) {
    const r = await this._op('buscar_por_telefone', { telefone: formatarTelefone(tel, this.formato) });
    return r?.id != null ? String(r.id) : null;
  }

  async criar(lead) {
    const r = await this._op('criar', { ...lead, telefone: formatarTelefone(lead.telefone, this.formato) });
    if (r?.id == null) throw new Error('CRM criou o lead mas não devolveu o id (confira "id_no_resultado" em config/crm.json)');
    return String(r.id);
  }

  async atualizar(crmId, lead) {
    await this._op('atualizar', { ...lead, crm_id: crmId, telefone: formatarTelefone(lead.telefone, this.formato) });
  }

  async registrarNota(crmId, nota) {
    await this._op('registrar_nota', { crm_id: crmId, nota });
  }
}

// ---------------- modo supabase ----------------

class CrmSupabase {
  constructor(cfg, formato) {
    this.c = cfg;
    this.formato = formato;
    this.col = { id: 'id', telefone: 'telefone', nome: 'nome', etapa: 'etapa', ...(cfg.colunas || {}) };
    this.base = `${String(cfg.url).replace(/\/+$/, '')}/rest/v1`;
    this.cab = { apikey: cfg.chave, Authorization: `Bearer ${cfg.chave}` };
  }

  _linha(lead, criando) {
    const l = { ...(lead.campos || {}) };
    if (lead.nome) l[this.col.nome] = lead.nome;
    if (lead.etapa_crm) l[this.col.etapa] = lead.etapa_crm;
    if (this.col.resumo && lead.resumo) l[this.col.resumo] = lead.resumo;
    if (criando) {
      l[this.col.telefone] = formatarTelefone(lead.telefone, this.formato);
      if (this.col.origem && this.c.valor_origem) l[this.col.origem] = this.c.valor_origem;
    }
    return l;
  }

  async buscarPorTelefone(tel) {
    const t = formatarTelefone(tel, this.formato);
    const url = `${this.base}/${this.c.tabela}?${this.col.telefone}=eq.${encodeURIComponent(t)}&select=${this.col.id}&limit=1`;
    const r = await chamar(url, { cabecalhos: this.cab });
    return r?.[0]?.[this.col.id] != null ? String(r[0][this.col.id]) : null;
  }

  async criar(lead) {
    const r = await chamar(`${this.base}/${this.c.tabela}`, {
      metodo: 'POST', cabecalhos: { ...this.cab, Prefer: 'return=representation' }, corpo: this._linha(lead, true),
    });
    const id = r?.[0]?.[this.col.id];
    if (id == null) throw new Error('Supabase não devolveu o id do lead criado');
    return String(id);
  }

  async atualizar(crmId, lead) {
    await chamar(`${this.base}/${this.c.tabela}?${this.col.id}=eq.${encodeURIComponent(crmId)}`, {
      metodo: 'PATCH', cabecalhos: { ...this.cab, Prefer: 'return=minimal' }, corpo: this._linha(lead, false),
    });
  }

  async registrarNota(crmId, nota) {
    const n = this.c.notas || {};
    if (!n.tabela) return; // sem tabela de notas: o resumo já vai na coluna de resumo
    await chamar(`${this.base}/${n.tabela}`, {
      metodo: 'POST', cabecalhos: { ...this.cab, Prefer: 'return=minimal' },
      corpo: { [n.coluna_lead || 'lead_id']: crmId, [n.coluna_texto || 'texto']: nota },
    });
  }
}

// ---------------- modo nenhum ----------------

class CrmNenhum {
  async buscarPorTelefone() { return null; }
  async criar(lead) { return `local-${lead.telefone}`; }
  async atualizar() {}
  async registrarNota() {}
}

export async function criarCrm(cfg, raiz) {
  const formato = cfg.formato_telefone || 'digitos';
  switch (cfg.modo) {
    case 'http': return new CrmHttp(cfg.http || {}, formato);
    case 'supabase': return new CrmSupabase(cfg.supabase || {}, formato);
    case 'modulo': {
      const mod = await import(pathToFileURL(path.join(raiz, 'crm', 'adaptador.js')).href);
      const a = mod.default ?? mod;
      for (const f of ['buscarPorTelefone', 'criar', 'atualizar', 'registrarNota']) {
        if (typeof a[f] !== 'function') throw new Error(`crm/adaptador.js precisa exportar a função ${f}`);
      }
      if (typeof a.iniciar === 'function') await a.iniciar(cfg);
      return a;
    }
    default: return new CrmNenhum();
  }
}
