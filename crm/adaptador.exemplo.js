// MODELO de adaptador próprio (modo "modulo" em config/crm.json).
// Use quando o CRM não tem API REST simples nem é Supabase (ex.: Firebase, Google Sheets, banco local).
// Na instalação, o Claude Code copia este arquivo para crm/adaptador.js e escreve as 4 funções
// olhando o código do CRM. crm/adaptador.js não vai para o GitHub (pode ter detalhes do CRM).
//
// O objeto "lead" recebido em criar/atualizar tem:
//   telefone   → só dígitos com DDI (5511999998888)
//   nome       → nome informado (ou o do WhatsApp)
//   etapa      → id da etapa no agente (config/etapas.json)
//   etapa_crm  → nome da etapa como está no CRM (valor_crm)
//   campos     → { campo_crm: valor } com os dados de qualificação já mapeados
//   dados      → { id_do_campo: valor } (sem mapeamento)
//   resumo     → resumo do lead escrito pelo agente
//   origem     → "WhatsApp"

export async function iniciar(cfg) {
  // opcional: abrir conexão, ler credenciais do process.env etc.
}

/** Devolve o id do lead no CRM, ou null se não existir. */
export async function buscarPorTelefone(telefone) {
  return null;
}

/** Cria o lead e devolve o id dele no CRM (string). */
export async function criar(lead) {
  throw new Error('crm/adaptador.js: criar() ainda não implementado');
}

/** Atualiza etapa, campos e resumo do lead. */
export async function atualizar(crmId, lead) {}

/** Registra uma anotação no histórico do lead (se o CRM tiver). */
export async function registrarNota(crmId, nota) {}
