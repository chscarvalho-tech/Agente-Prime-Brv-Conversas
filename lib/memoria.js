// Memória local do agente: histórico das conversas e o vínculo de cada número com o lead no CRM.
// O CRM continua sendo a fonte oficial do lead; aqui fica só o que o agente precisa para conversar.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const ESQUEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS conversas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jid TEXT NOT NULL UNIQUE,
  telefone TEXT,
  nome_whatsapp TEXT,
  crm_id TEXT,
  crm_pendente INTEGER NOT NULL DEFAULT 0,
  etapa TEXT NOT NULL,
  dados TEXT NOT NULL DEFAULT '{}',
  resumo TEXT,
  modo TEXT NOT NULL DEFAULT 'agente',
  pausado_ate INTEGER,
  optout INTEGER NOT NULL DEFAULT 0,
  destino TEXT,
  ultimo_in_respondido INTEGER NOT NULL DEFAULT 0,
  criado_em INTEGER NOT NULL,
  atualizado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mensagens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  direcao TEXT NOT NULL,
  autor TEXT NOT NULL,
  texto TEXT NOT NULL DEFAULT '',
  wa_id TEXT UNIQUE,
  criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conversa ON mensagens(conversa_id, id);

CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversa_id INTEGER REFERENCES conversas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  detalhe TEXT NOT NULL DEFAULT '{}',
  criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eventos ON eventos(tipo, criado_em);

CREATE TABLE IF NOT EXISTS lacunas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversa_id INTEGER REFERENCES conversas(id) ON DELETE SET NULL,
  pergunta TEXT NOT NULL,
  criado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS uso_ia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversa_id INTEGER,
  modelo TEXT,
  entrada INTEGER NOT NULL DEFAULT 0,
  saida INTEGER NOT NULL DEFAULT 0,
  cache INTEGER NOT NULL DEFAULT 0,
  duracao_ms INTEGER,
  criado_em INTEGER NOT NULL
);
`;

const ler = (c) => c && { ...c, dados: JSON.parse(c.dados || '{}') };

export class Memoria {
  constructor(arquivo) {
    if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    this.db = new DatabaseSync(arquivo);
    this.db.exec(ESQUEMA);
  }

  conversaPorJid(jid) { return ler(this.db.prepare('SELECT * FROM conversas WHERE jid = ?').get(jid)); }
  conversaPorId(id) { return ler(this.db.prepare('SELECT * FROM conversas WHERE id = ?').get(id)); }
  conversaPorTelefone(tel) {
    const d = String(tel).replace(/\D/g, '');
    return ler(this.db.prepare("SELECT * FROM conversas WHERE telefone = ? OR telefone LIKE '%' || ? ORDER BY id DESC").get(d, d.slice(-10)));
  }

  criarConversa({ jid, telefone, nome_whatsapp, etapa }) {
    const agora = Date.now();
    const r = this.db.prepare(
      'INSERT INTO conversas (jid, telefone, nome_whatsapp, etapa, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(jid, telefone, nome_whatsapp ?? null, etapa, agora, agora);
    return this.conversaPorId(Number(r.lastInsertRowid));
  }

  atualizar(id, patch) {
    const campos = Object.keys(patch);
    if (!campos.length) return this.conversaPorId(id);
    const valores = campos.map((k) => (k === 'dados' ? JSON.stringify(patch[k]) : patch[k]));
    this.db.prepare(`UPDATE conversas SET ${campos.map((k) => `${k} = ?`).join(', ')}, atualizado_em = ? WHERE id = ?`)
      .run(...valores, Date.now(), id);
    return this.conversaPorId(id);
  }

  /** Grava a mensagem; devolve null se for reentrega (mesmo wa_id). */
  inserirMensagem({ conversa_id, direcao, autor, texto, wa_id = null }) {
    try {
      const r = this.db.prepare(
        'INSERT INTO mensagens (conversa_id, direcao, autor, texto, wa_id, criado_em) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(conversa_id, direcao, autor, texto ?? '', wa_id, Date.now());
      return Number(r.lastInsertRowid);
    } catch (e) {
      if (/UNIQUE/i.test(e.message)) return null;
      throw e;
    }
  }

  mensagens(conversaId, limite = 40) {
    return this.db.prepare('SELECT * FROM (SELECT * FROM mensagens WHERE conversa_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id')
      .all(conversaId, limite);
  }

  mensagensApos(conversaId, idMin) {
    return this.db.prepare("SELECT * FROM mensagens WHERE conversa_id = ? AND id > ? AND direcao = 'in' ORDER BY id").all(conversaId, idMin);
  }

  evento(conversaId, tipo, detalhe = {}) {
    this.db.prepare('INSERT INTO eventos (conversa_id, tipo, detalhe, criado_em) VALUES (?, ?, ?, ?)')
      .run(conversaId, tipo, JSON.stringify(detalhe), Date.now());
  }

  eventos(conversaId, limite = 50) {
    return this.db.prepare('SELECT * FROM eventos WHERE conversa_id = ? ORDER BY id DESC LIMIT ?').all(conversaId, limite)
      .map((e) => ({ ...e, detalhe: JSON.parse(e.detalhe) }));
  }

  /** Registra a pergunta sem resposta, sem repetir a mesma pergunta na mesma conversa. */
  lacuna(conversaId, pergunta, jaRegistradas = this.lacunasDaConversa(conversaId)) {
    const norm = (s) => s.toLowerCase().replace(/[^a-zà-ú0-9 ]/g, '').split(/\s+/).filter((p) => p.length > 3);
    const novas = new Set(norm(pergunta));
    const parecida = jaRegistradas.some((l) => {
      const antigas = norm(l.pergunta);
      const comuns = antigas.filter((p) => novas.has(p)).length;
      return comuns / Math.max(1, Math.min(antigas.length, novas.size)) >= 0.6;
    });
    if (parecida) return false;
    this.db.prepare('INSERT INTO lacunas (conversa_id, pergunta, criado_em) VALUES (?, ?, ?)').run(conversaId, pergunta, Date.now());
    return true;
  }

  lacunasDaConversa(conversaId) {
    return this.db.prepare('SELECT * FROM lacunas WHERE conversa_id = ? ORDER BY id').all(conversaId);
  }

  lacunas(limite = 100) {
    return this.db.prepare('SELECT * FROM lacunas ORDER BY id DESC LIMIT ?').all(limite);
  }

  registrarUso(conversaId, u) {
    this.db.prepare('INSERT INTO uso_ia (conversa_id, modelo, entrada, saida, cache, duracao_ms, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(conversaId, u.modelo ?? null, u.entrada ?? 0, u.saida ?? 0, u.cache ?? 0, u.duracao_ms ?? null, Date.now());
  }

  conversasComCrmPendente() {
    return this.db.prepare('SELECT * FROM conversas WHERE crm_pendente = 1').all().map(ler);
  }

  resumoGeral(desdeMs = 0) {
    const n = (sql, ...p) => Number(this.db.prepare(sql).get(...p).n);
    return {
      conversas: n('SELECT COUNT(*) n FROM conversas WHERE criado_em >= ?', desdeMs),
      por_etapa: this.db.prepare('SELECT etapa, COUNT(*) n FROM conversas WHERE criado_em >= ? GROUP BY etapa').all(desdeMs),
      com_equipe: n("SELECT COUNT(*) n FROM conversas WHERE modo = 'equipe'"),
      crm_pendente: n('SELECT COUNT(*) n FROM conversas WHERE crm_pendente = 1'),
      respostas_ia: n('SELECT COUNT(*) n FROM uso_ia WHERE criado_em >= ?', desdeMs),
      erros_ia: n("SELECT COUNT(*) n FROM eventos WHERE tipo = 'erro_ia' AND criado_em >= ?", desdeMs),
      erros_crm: n("SELECT COUNT(*) n FROM eventos WHERE tipo = 'erro_crm' AND criado_em >= ?", desdeMs),
      lacunas: n('SELECT COUNT(*) n FROM lacunas WHERE criado_em >= ?', desdeMs),
    };
  }

  apagarConversa(jid) {
    this.db.prepare('DELETE FROM conversas WHERE jid = ?').run(jid);
  }
}
