# TODO da API

Roteiro para construir a API da Feitio. Ele tem duas partes:

- **Parte A, comércio:** os módulos de loja, seguindo o escopo do Vendure, adaptados ao nosso desenho (multitenant com RLS, Brasil como único mercado e fornecedores externos atrás de adaptadores).
- **Parte B, plataforma:** o que é do negócio da Feitio e não existe no Vendure: gestão dos lojistas, planos, cobrança, chaves de API e limites de uso.

Dentro de cada parte, as fases estão em ordem de dependência. Cada fase da Parte B indica em que momento da Parte A ela deve entrar.

## Regras para todo módulo

Um módulo só está pronto quando:

- [ ] foi desenvolvido com TDD;
- [ ] toda tabela de negócio tem a coluna do tenant, as regras de RLS e um teste de isolamento entre tenants;
- [ ] identificadores, dinheiro e slugs usam os tipos do domínio;
- [ ] as rotas de loja (`/v1`, tenant pelo cabeçalho) e as de painel (tenant pela sessão) estão separadas;
- [ ] as rotas aparecem completas no Swagger, com tipos de entrada, de resposta e erros;
- [ ] fornecedores externos ficam atrás de uma interface, em `adapters/`;
- [ ] o CLAUDE.md da API foi atualizado, se o módulo trouxe regra nova.

## O que não vamos trazer do Vendure agora

- Vários idiomas e traduções de conteúdo.
- Várias moedas.
- Vários vendedores na mesma loja (marketplace).
- Zonas e países para imposto e frete. O mercado é só o Brasil.
- Campos personalizados por tenant.

---

# Parte A: Comércio

## Fase 0: Base (concluída)

- [x] Monorepo, Biome, Vitest e CI
- [x] PostgreSQL com Drizzle e migrações
- [x] Tenants, identificação por requisição e isolamento com RLS
- [x] Configurações e tema da loja
- [x] Valkey e sessões por cookie
- [x] Armazenamento de arquivos compatível com S3
- [x] Plugins do Fastify: helmet, CSRF e multipart
- [x] Tipos do domínio: identificadores, slug e dinheiro
- [x] Swagger

## Fase 1: Acesso ao painel

Equivale a Administrators, Roles e Sessions do Vendure.

- [x] Usuários, com e-mail único e senha em hash
- [x] Vínculo entre usuário e tenant, com papel (dono ou equipe)
- [ ] Login, logout e encerramento de todas as sessões
- [ ] Troca de loja ativa para usuário com mais de um vínculo
- [ ] Rota de dados do usuário logado
- [ ] Limite de tentativas de login
- [ ] Guards de sessão e de papel
- [ ] Edição das configurações da loja pelo dono
- [ ] Comando para criar loja com o primeiro usuário dono
- [ ] Depois do módulo de notificações: convite por e-mail e recuperação de senha

## Fase 2: Catálogo

Equivale a Product, ProductVariant, ProductOption, Facet, Collection e Asset.

- [ ] Arquivos (assets): upload de imagem para o bucket público, com registro no banco, e remoção
- [ ] Produtos: nome, slug, descrição, situação (rascunho, ativo, arquivado) e imagens
- [ ] Grupos de opções e opções (por exemplo, Tamanho: P, M, G e Cor: Azul)
- [ ] Variantes: SKU, preço, combinação de opções e imagem própria
- [ ] Regra: todo produto tem ao menos uma variante, e o preço fica na variante
- [ ] Atributos para filtro (facets), como marca, material e gênero
- [ ] Coleções: agrupamento manual e por regra (por atributo), com ordem e hierarquia
- [ ] Rotas de loja: listar com paginação, filtrar por coleção e atributo, ordenar, buscar por slug
- [ ] Rotas de painel: criar, editar, arquivar e reordenar
- [ ] Campos de SEO por produto e por coleção (título e descrição)

## Fase 3: Estoque

Equivale a StockLocation, StockLevel e StockMovement.

- [ ] Local de estoque (um por loja no início, com o modelo aceitando mais)
- [ ] Saldo por variante: disponível e reservado
- [ ] Movimentações registradas: ajuste, reserva, baixa por venda, liberação e devolução
- [ ] Política por variante: controlar estoque ou não, e permitir venda sem saldo
- [ ] Trava contra venda dupla da última unidade
- [ ] Limite de estoque baixo, para aviso no painel

## Fase 4: Clientes

Equivale a Customer, Address e CustomerGroup.

- [ ] Clientes da loja: nome, e-mail, telefone e CPF ou CNPJ, com tipos do domínio
- [ ] Endereços, com CEP validado e endereço padrão de entrega e de cobrança
- [ ] Cliente visitante (compra sem cadastro) e cliente cadastrado
- [ ] Autenticação do comprador, separada da do painel, pensada para a loja em outro domínio
- [ ] Grupos de clientes, para promoções e preços
- [ ] Histórico do cliente
- [ ] LGPD: exportar e apagar os dados de um cliente a pedido

## Fase 5: Eventos e filas

Equivale ao EventBus e ao JobQueue. Vem antes de pedido e pagamento porque os dois dependem disso.

- [ ] Eventos de domínio publicados pelos módulos (produto criado, pedido pago, estoque alterado)
- [ ] Filas no Valkey com BullMQ: tentativas, espera crescente e fila de falhas
- [ ] Processo de worker separado da API
- [ ] Idempotência: a mesma tarefa executada duas vezes não duplica efeito
- [ ] Contexto do tenant preservado dentro das tarefas

## Fase 6: Carrinho e pedido

Equivale a Order, OrderLine e à máquina de estados do pedido. No Vendure, o carrinho é o próprio pedido em estado inicial.

- [ ] Pedido ativo (carrinho), identificado por um token guardado pela loja
- [ ] Adicionar, alterar quantidade e remover itens, com o preço sempre calculado pela API
- [ ] Totais: subtotal, descontos, frete e total, em centavos
- [ ] Máquina de estados: montando, aguardando pagamento, pago, em separação, enviado, entregue e cancelado
- [ ] Transições validadas, com registro de quem fez e quando
- [ ] Reserva de estoque na passagem para pagamento e baixa na confirmação
- [ ] Vínculo do pedido com cliente e endereços
- [ ] Número de pedido legível, sequencial por loja
- [ ] Histórico e observações internas do pedido
- [ ] Expiração de carrinhos abandonados e liberação do estoque reservado
- [ ] Rotas de painel: listar, filtrar, detalhar, cancelar e alterar estado

## Fase 7: Frete

Equivale a ShippingMethod, com verificação de elegibilidade e cálculo, e a Fulfillment.

- [ ] Peso e dimensões por variante
- [ ] Métodos de frete por loja: nome, situação e regra de cálculo
- [ ] Interface de cálculo de frete, com adaptadores
- [ ] Adaptador: preço fixo e frete grátis acima de um valor
- [ ] Adaptador: agregador de transportadoras (Melhor Envio)
- [ ] Cotação por CEP no carrinho
- [ ] Envio (fulfillment): código de rastreio, etiqueta e situação
- [ ] Retirada na loja como método

## Fase 8: Pagamento

Equivale a PaymentMethod, Payment e Refund.

- [ ] Interface de gateway de pagamento
- [ ] Adaptador do Asaas: Pix, cartão e boleto
- [ ] Subconta do lojista no Asaas, criada pela API
- [ ] Divisão do pagamento, com a parte da Feitio
- [ ] Cartão tokenizado pelo gateway, sem dados de cartão no nosso banco nem em log
- [ ] Webhook do Asaas: validação de origem, idempotência e processamento em fila
- [ ] Pagamento ligado ao pedido, com situação e histórico
- [ ] Reembolso total e parcial
- [ ] Conciliação: tarefa que confere pagamentos pendentes com o gateway

## Fase 9: Checkout

Junta carrinho, cliente, frete e pagamento em um fluxo único, consumido pelo app de checkout.

- [ ] Etapas: identificação, endereço, frete e pagamento
- [ ] Validação final antes de cobrar: estoque, preços e frete ainda válidos
- [ ] Criação da cobrança e retorno dos dados para a tela (código Pix, linha do boleto, situação do cartão)
- [ ] Consulta da situação do pedido para a página de confirmação
- [ ] Proteção contra envio duplicado do mesmo pedido

## Fase 10: Notificações

Equivale ao EmailPlugin.

- [ ] Interface de envio de e-mail, com adaptador para o serviço escolhido
- [ ] Modelos por evento: pedido recebido, pagamento confirmado, pedido enviado, pedido cancelado
- [ ] Modelos com o nome, o logo e as cores da loja
- [ ] Envio sempre pela fila
- [ ] Convite de usuário e recuperação de senha do painel
- [ ] Adaptador de WhatsApp, como módulo avulso

## Fase 11: Promoções

Equivale a Promotion, com condições e ações.

- [ ] Promoção com período de validade, situação e limite de uso
- [ ] Cupom, com limite por cliente
- [ ] Condições: valor mínimo, produto ou coleção no carrinho, grupo de clientes
- [ ] Ações: percentual, valor fixo, frete grátis e desconto por item
- [ ] Aplicação automática e por cupom, com o desconto registrado em cada linha do pedido
- [ ] Regra de combinação entre promoções

## Fase 12: Fiscal

Equivale a TaxCategory e TaxRate, reduzido ao que o Brasil exige, mais a nota fiscal.

- [ ] Dados fiscais por produto: NCM, origem e unidade
- [ ] Dados fiscais da loja: regime tributário e inscrições
- [ ] Interface de emissão de nota, com adaptador para o serviço escolhido
- [ ] Emissão pela fila, ao confirmar o pagamento ou ao enviar
- [ ] XML e PDF da nota no bucket privado
- [ ] Cancelamento de nota

## Fase 13: Busca

Equivale ao DefaultSearchPlugin.

- [ ] Busca textual de produtos no próprio PostgreSQL
- [ ] Filtros por atributo, coleção e faixa de preço, com contagem por filtro
- [ ] Índice atualizado pelos eventos do catálogo

## Fase 14: Integrações

- [ ] Interface de ERP, com adaptador para o primeiro ERP escolhido
- [ ] Sincronização de pedidos e de estoque pela fila
- [ ] Webhooks de saída: a loja assina eventos e recebe chamadas assinadas

## Fase 15: Operação

- [ ] Registro de auditoria das ações do painel
- [ ] Erros enviados a um serviço de monitoramento
- [ ] Logs estruturados, com tenant e identificador da requisição
- [ ] Cache das leituras mais frequentes no Valkey
- [ ] Tarefas agendadas: carrinhos abandonados, conciliação e limpeza de sessões
- [ ] Versionamento de rotas ativo, com a política de mudanças documentada

---

# Parte B: Plataforma

O que pertence ao negócio da Feitio. As tabelas desta parte são da plataforma, não de um lojista: ficam fora do RLS por tenant e só são acessadas por rotas internas da Feitio.

## P1: Administração interna da Feitio

Entra junto com a Fase 1. Substitui o comando de linha de criação de loja quando houver painel interno.

- [ ] Usuários internos da Feitio, separados dos usuários de lojistas, com autenticação própria
- [ ] Criar, editar, suspender e reativar tenants
- [ ] Ciclo de vida do tenant: em implantação, ativo, suspenso e cancelado
- [ ] Tenant suspenso: loja e checkout fora do ar com aviso, painel só para leitura
- [ ] Acesso de suporte a um tenant, com registro de quem acessou e quando
- [ ] Visão geral: lojas ativas, pedidos e volume vendido por loja

## P2: Ambientes de teste e de produção

Entra antes da Fase 8, porque o pagamento precisa de um modo de teste.

- [ ] Cada lojista tem dois ambientes isolados: produção e teste
- [ ] O ambiente de teste é um tenant próprio, ligado ao de produção, com dados separados pelo mesmo RLS
- [ ] No ambiente de teste, pagamento, frete e nota usam o modo de testes dos fornecedores e nunca movimentam dinheiro real
- [ ] O ambiente de teste não conta para cobrança e tem limites menores
- [ ] Opção de limpar os dados do ambiente de teste

## P3: Chaves de API

Entra depois da Fase 6, quando houver rotas que valham acesso por sistemas externos.

- [ ] Dois tipos de chave: secreta de produção e secreta de teste, com prefixos distintos e reconhecíveis
- [ ] A chave de teste só enxerga o ambiente de teste, e a de produção só o de produção
- [ ] Geração no painel pelo dono da loja, com nome e permissões
- [ ] O valor completo é exibido uma única vez, e o banco guarda apenas o hash
- [ ] Prefixo e últimos caracteres visíveis no painel, para identificar a chave
- [ ] Permissões por chave (por exemplo: ler pedidos, alterar estoque)
- [ ] Revogação imediata e troca de chave com período de convivência entre a antiga e a nova
- [ ] Data do último uso e origem das chamadas
- [ ] Guard que resolve a chave para o tenant e alimenta o mesmo contexto de RLS
- [ ] O identificador público usado pelas lojas continua separado: não é segredo e só dá acesso às rotas públicas

## P4: Limites de uso

Entra junto com a P3. O limite por tenant é obrigatório em um sistema multitenant: sem ele, uma loja com tráfego anormal ou uma integração com defeito degrada todas as outras.

- [ ] Limite de requisições por chave de API, em janela curta
- [ ] Limite de requisições por tenant, somando todas as chaves e as rotas públicas
- [ ] Limite por endereço de origem nas rotas públicas das lojas
- [ ] Limites diferentes por plano e por ambiente (teste menor que produção)
- [ ] Contadores no Valkey
- [ ] Resposta padrão ao exceder, com cabeçalhos informando o limite, o restante e quando libera
- [ ] Possibilidade de ajustar o limite de um tenant específico pela administração interna

## P5: Planos e módulos

Entra antes da primeira loja em produção.

- [ ] Planos da Feitio, com preço e o que cada um inclui
- [ ] Módulos avulsos ativáveis por tenant (marketplaces, WhatsApp)
- [ ] Verificação de módulo: rota de módulo não contratado responde com erro claro
- [ ] Cotas por plano: requisições de API por mês e outras que forem definidas
- [ ] Histórico de mudanças de plano e de módulos

## P6: Medição e cobrança

Entra depois da P5.

- [ ] Medição de uso por tenant e por chave: requisições de API e pedidos processados
- [ ] Consolidação periódica do uso, do Valkey para o PostgreSQL
- [ ] Mensalidade recorrente do lojista, cobrada pelo Asaas
- [ ] Cobrança da implementação: 50% na assinatura e 50% na entrega
- [ ] Excedente de uso somado à cobrança do mês
- [ ] Percentual da Feitio sobre as vendas, configurável por tenant, aplicado na divisão do pagamento
- [ ] Contrato: data de início, fidelidade de 12 meses e reajuste anual
- [ ] Inadimplência: aviso, prazo e suspensão automática do tenant
- [ ] Tela de uso e de faturas para o lojista

## P7: Entrada de um lojista novo

Entra antes da primeira loja em produção.

- [ ] Fluxo único que cria o tenant, as configurações, o ambiente de teste, o usuário dono e a subconta no Asaas
- [ ] Coleta e envio dos documentos do lojista para o Asaas
- [ ] Acompanhamento da aprovação da subconta
- [ ] Lista de pendências da implantação, visível para a Feitio e para o lojista

## P8: Domínios das lojas

Entra antes da primeira loja em produção.

- [ ] Domínios por tenant: o da loja e o do checkout
- [ ] Verificação de que o domínio pertence ao lojista
- [ ] Resolução de domínio para tenant, com cache no Valkey
- [ ] Origens permitidas por tenant, para as chamadas vindas do navegador