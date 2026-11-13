# Conectar o agente ao CRM da empresa

O CRM foi criado pela própria empresa com o Claude, então não existe um padrão: descubra como ele guarda os leads e escolha um dos modos de `config/crm.json`. O agente precisa de 4 operações:

| Operação | Para quê |
|---|---|
| buscar por telefone | não duplicar lead que já existe no CRM |
| criar | criar o lead assim que a primeira mensagem chega |
| atualizar | gravar etapa, dados de qualificação e resumo a cada resposta |
| registrar nota | gravar no histórico do lead mudanças de etapa, transferências e perguntas sem resposta (opcional) |

## 1. Descobrir como o CRM funciona

Pergunte à dona, nesta ordem, e pare quando tiver o suficiente:

1. "Onde o CRM está? Me passe a pasta do projeto no computador ou o link do repositório." **Se tiver o código, leia você mesmo**: procure as rotas de API (`/api/leads`, `app/api`, `routes`, `server`), o esquema do banco (Prisma `schema.prisma`, migrações SQL, Supabase `supabase/migrations`, Firebase) e a autenticação.
2. Se não tiver o código: "Qual o endereço do CRM? Ele usa Supabase, Firebase, Google Sheets ou outro banco?" (Lovable e Bolt usam Supabase quase sempre.)
3. Confirme com ela: a tabela/entidade de leads, o campo de telefone (e o formato gravado: `5511999998888`, `+55...`, `11999998888` ou com máscara), o campo de etapa e os valores exatos das etapas, os campos que vão receber os dados de qualificação, e se existe tabela/aba de anotações.

Nunca altere o CRM dela sem pedir. Se faltar um campo (ex.: "resumo" ou "origem"), sugira criar e espere a aprovação.

## 2. Escolher o modo

### Modo `supabase` (CRM feito no Lovable, Bolt ou com Supabase)

No `.env`: `CRM_URL=https://<projeto>.supabase.co` e `CRM_TOKEN=<chave>`.
A chave precisa conseguir ler e gravar na tabela de leads. Com RLS ligado, a chave `anon` normalmente não grava: use a **service_role** (Supabase → Project Settings → API). Ela dá acesso total ao banco: fica só no `.env` desta máquina, nunca no GitHub e nunca repetida na conversa.

Em `config/crm.json` → `supabase`: `tabela`, `colunas` (`id`, `telefone`, `nome`, `etapa`, e opcionalmente `resumo` e `origem`), `valor_origem`, e `notas.tabela` se houver tabela de notas. Os campos de qualificação vão para as colunas indicadas em `campo_crm` de cada campo em `config/etapas.json`.

### Modo `http` (CRM com API REST própria)

No `.env`: `CRM_URL` (endereço base) e `CRM_TOKEN`, se a API pedir. Se ela ainda não tiver chave de API, peça ao Claude dela (ou crie, com autorização) uma rota protegida por token.
Em `config/crm.json` → `http`, descreva cada operação:
- `caminho` aceita `{telefone}` e `{crm_id}`;
- `corpo` aceita `{nome}`, `{telefone}`, `{etapa_crm}`, `{resumo}`, `{nota}`, `{origem}`; `"$campos": true` espalha os campos de qualificação (`campo_crm: valor`);
- `id_no_resultado` é o caminho até o id na resposta (`id`, `data.id`, `0.id`, `data.0.id`...). Para a busca, se a API devolve lista vazia quando não acha, `0.id` funciona.

### Modo `modulo` (qualquer outro caso)

Firebase, Google Sheets, banco local, API com fluxo diferente: copie `crm/adaptador.exemplo.js` para `crm/adaptador.js` e escreva as 4 funções. Credenciais vêm do `process.env`. O arquivo fica fora do GitHub.

## 3. Testar

```bash
node cli.js validar
node cli.js testar-crm
```

O teste cria um lead "TESTE Agente WhatsApp (pode apagar)" com o telefone 5500900000000, muda a etapa, grava uma nota e confere a busca. Peça para ela abrir o CRM e confirmar que viu o lead, a etapa e a nota. Depois ela apaga o lead de teste.

Por fim, rode uma conversa simulada gravando no CRM: `node cli.js testar "oi, quero saber sobre ..." crm1 --crm`, confira no CRM e apague.
