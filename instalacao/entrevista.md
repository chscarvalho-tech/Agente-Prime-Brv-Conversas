# Entrevista de instalação: montar o conhecimento do agente

Roteiro para o Claude Code conduzir com a dona do negócio. O resultado vai para `conhecimento/*.md` e `config/*.json`.

## Antes de perguntar: procure o que já existe

Pergunte primeiro: "Você tem algum material pronto sobre a empresa? Site, Instagram, apresentação, PDF de produtos, tabela de taxas, roteiro que a equipe usa no WhatsApp, prints de conversas boas?" Leia tudo o que ela mandar (arquivos, links, textos colados) e **olhe o próprio CRM** (etapas, campos, produtos cadastrados). Depois pergunte só o que faltar e confirme o que você deduziu.

## Como conduzir

- Um bloco por vez, no máximo 3 a 4 perguntas por mensagem, em linguagem simples.
- Depois de cada bloco, mostre um resumo do que entendeu e peça "confirma ou corrige?". Só então grave no arquivo.
- "Não sei" e "depois eu vejo" são respostas válidas: grave a regra "transferir para a equipe" no lugar e anote como pendência.
- Nunca preencha com informação inventada ou "típica do mercado". Sugestões suas vão marcadas como sugestão até ela aprovar.
- Grave à medida que avança (não deixe tudo para o final), para não perder nada se a sessão cair.

## Bloco 1: a empresa → `conhecimento/01-empresa.md`

1. Nome da empresa como deve aparecer para o cliente. Em uma frase, o que vocês fazem?
2. Há quanto tempo atuam? Onde atendem (cidades, online, presencial, endereço)?
3. Vocês são correspondente bancário, corretora, assessoria, financeira própria? De quais bancos/instituições? Têm registro (SUSEP, CVM, Bacen) que pode ser citado?
4. O que diferencia vocês de um banco ou de um concorrente? (peça fatos: prazo, taxa, atendimento, aprovação)
5. Canais oficiais: site, Instagram, telefone, e-mail.
6. Como funciona o processo do primeiro contato até o cliente receber (dinheiro, apólice, cota, contrato)? Quanto tempo leva cada passo?

## Bloco 2: produtos → `conhecimento/02-produtos-e-servicos.md`

Para **cada** produto:
1. O que é, em linguagem que o cliente entende.
2. Para quem é, e para quem não é (o que desqualifica).
3. Requisitos (idade, renda, vínculo, margem consignável, score, bem em garantia...).
4. Documentos necessários.
5. Condições que o agente pode falar: faixas de taxa, prazos, valores mínimos e máximos. Ou a regra "condição só na simulação com a equipe".
6. Prazo até a liberação.
7. O que o agente **não** pode dizer sobre este produto.
8. Qual é o próximo passo de venda (simulação, documentos, ligação, visita).
9. Qual produto vocês mais querem vender agora? (vira prioridade na conversa)

## Bloco 3: perguntas frequentes → `conhecimento/03-perguntas-frequentes.md`

1. Peça as 10 a 20 perguntas que os clientes mais fazem no WhatsApp, com a resposta que a equipe dá.
2. Depois **sugira** as perguntas comuns do segmento dela (lista abaixo) e pergunte quais respostas ela quer dar. Só grave as que ela responder.
3. Grave no formato pergunta do cliente + resposta aprovada.

Sugestões por segmento (use as que fazem sentido para os produtos dela):

- **Crédito consignado (INSS, servidor, CLT):** Quem pode fazer? Negativado pode? Qual a taxa? Quanto tempo para cair? Preciso ir até vocês? Vocês ligam para pedir senha? Posso fazer portabilidade? Tenho margem? Quanto consigo pegar? Posso quitar antes?
- **Antecipação do saque-aniversário FGTS:** Como funciona? Precisa autorizar no app do FGTS? Quanto posso antecipar? E se eu for demitido? Qual o custo?
- **Empréstimo pessoal / com garantia (veículo, imóvel):** O bem fica com quem? Preciso de avaliação? Taxa é fixa? Qual prazo máximo? Aceita imóvel financiado?
- **Financiamento imobiliário / veículos:** Qual a entrada mínima? Posso usar FGTS? Quanto tempo de análise? Autônomo consegue?
- **Consórcio:** Tem juros? Como funciona o lance? Quanto tempo para ser contemplado? Posso desistir? Taxa de administração?
- **Seguros:** O que cobre? Tem carência? Como aciono? Posso cancelar?
- **Renegociação / limpa nome:** Vocês tiram o nome do Serasa? Quanto tempo? Preciso pagar antes?
- **Investimentos / assessoria:** Qual o mínimo? Tem garantia do FGC? Qual o rendimento? Vocês cobram taxa?
- **Gerais:** Vocês são confiáveis / como sei que não é golpe? Precisam do meu CPF por quê? Posso falar com uma pessoa? Qual o horário? Onde ficam?

## Bloco 4: objeções → `conhecimento/04-objecoes.md`

1. Quais os motivos mais comuns para o cliente não fechar?
2. Como a equipe responde quando consegue reverter?
3. Sugira as do segmento (ex.: "vou pesquisar em outro banco", "os juros são altos", "tenho medo de golpe", "vou falar com meu marido/esposa", "agora não é o momento") e pergunte a resposta dela para cada uma.

## Bloco 5: etapas e qualificação → `config/etapas.json`

Abra o CRM junto com ela (ou leia o código/banco dele) e alinhe:
1. Quais são as etapas do funil **exatamente como estão no CRM**? (vai em `valor_crm`)
2. O que precisa acontecer para o lead passar de uma etapa para a outra? (vai em `avancar_quando`)
3. Em que etapa o agente para e a equipe assume? Qual etapa é "perdido/desqualificado"?
4. Quais dados o agente deve coletar, em que ordem, e quais são obrigatórios? Para cada um: em qual **campo do CRM** ele vai (`campo_crm`)? Tem lista fechada de opções?
5. Dados sensíveis (CPF, renda, data de nascimento, benefício): o agente deve pedir pelo WhatsApp ou deixa para a equipe? Recomende pedir só o mínimo para qualificar.
6. Quem é desqualificado? (vai em `regras_desqualificacao`)
7. Quando o agente deve passar para uma pessoa? Comece pelas regras do modelo e ajuste. (vai em `regras_transferencia`)

## Bloco 6: equipe e transferência → `config/etapas.json` (destinos) e `config/agente.json`

1. Quem recebe os leads? Nome e WhatsApp (com DDI e DDD) de cada pessoa ou fila. Divide por produto, região ou rodízio?
2. Horário real de atendimento da equipe (dias e horas). O agente responde 24 h, mas avisa quando a equipe só retorna no próximo horário.
3. Depois que a equipe assume, em quantas horas o agente pode voltar a responder se a equipe não falar mais? (padrão 12 h)
4. Algum número que o agente deve ignorar (sócios, parceiros, fornecedores)?

## Bloco 7: jeito de falar → `config/agente.json`

1. Nome do agente (ex.: "Ana, assistente da Prime Brv"). Ele sempre se apresenta como assistente virtual.
2. Tom: mais formal (senhor/senhora) ou próximo (você)? Emojis: sim ou não?
3. Peça 2 ou 3 prints/trechos de conversas boas da equipe para copiar o jeito de falar.
4. Palavras que a empresa usa ou evita (ex.: "crédito" em vez de "empréstimo").

## Bloco 8: limites → `conhecimento/05-regras-e-limites.md`

1. Assuntos que vão sempre para a equipe (contrato ativo, segunda via, renegociação...).
2. O que nunca pode ser dito ou prometido.
3. Já tiveram problema com golpe usando o nome da empresa? Como orientar o cliente?
4. Pode enviar materiais (PDF, links, vídeos)? Quais, e com link público?

## Bloco 9: sugestões de ações (você propõe, ela escolhe)

Com base no que aprendeu, proponha ações que o agente ou a equipe podem adotar. Mostre como lista curta, com o ganho esperado de cada uma, e grave só o que ela aprovar (no conhecimento ou na configuração). Ideias para avaliar:

- **Pergunta de abertura certa:** abrir pelo produto mais procurado ("Você quer saber de consignado, FGTS ou outro?") para qualificar mais rápido.
- **Pré-análise no WhatsApp:** coletar os 2 ou 3 dados que decidem se a pessoa tem perfil antes de passar para a equipe, para a equipe só falar com quem tem chance.
- **Lista de documentos antecipada:** mandar a lista de documentos assim que o lead é qualificado, para a simulação andar mais rápido.
- **Mensagem antigolpe:** frase padrão "nunca pedimos pagamento antecipado nem senha" no primeiro atendimento, que gera confiança no setor.
- **Fora do horário:** responder na hora e deixar o lead pronto para a equipe ligar de manhã.
- **Lacunas semanais:** toda semana rodar `node cli.js lacunas` e transformar as perguntas sem resposta em novas FAQs.
- **Reativação de leads parados:** (exige combinar regras e é envio ativo, com risco de bloqueio no WA-AKG; só com aprovação e com volume baixo).
- **Pós-venda / indicação:** depois do fechamento, a equipe pede indicação (fica com a equipe, não com o agente).
- **Campos extras no CRM:** se o CRM não tiver campo para algo que o agente coleta (ex.: "melhor horário"), sugerir criar.

## Ao terminar

1. Rode `node cli.js validar` até ficar sem erros e sem `[PREENCHER]`.
2. Mostre a ela um resumo final: produtos cobertos, etapas, dados coletados, quem recebe os leads, pendências.
3. Siga para os testes (CLAUDE.md, passo "Testar antes de ligar").
