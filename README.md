# feitio-core

Núcleo da plataforma Feitio: a API, o painel do lojista, o checkout e os pacotes compartilhados que as lojas dos clientes usam.

As lojas dos clientes não ficam aqui. Cada uma tem o próprio repositório, criado a partir do `storefront-starter`.

As interfaces (painel, checkout e lojas) acessam a API por código gerado: cada uma gera o próprio cliente com o [Kubb](https://kubb.dev), a partir da especificação OpenAPI (Swagger) que a API publica.

## Estrutura

```text
feitio-core/
├── apps/
│   ├── api/                  # API multitenant (NestJS + Fastify + Drizzle)
│   ├── admin/                # painel do lojista (React + Vite, só no navegador)
│   └── checkout/             # checkout único de todas as lojas (React + Vite, só no navegador)
├── packages/
│   ├── storefront-starter/   # projeto-base das lojas (TanStack Start, com renderização no servidor)
│   └── config/               # tsconfigs compartilhados (base, Node e React com Vite)
├── biome.json
├── vitest.config.ts
├── pnpm-workspace.yaml
└── package.json
```

- `apps/`: o que é publicado e fica no ar.
- `packages/`: código reutilizado pelos apps e pelas lojas.

## Requisitos

- Node.js 22 ou superior
- pnpm 12 (a versão exata está no campo `packageManager` do `package.json`)
- Docker com Docker Compose, para o Valkey de desenvolvimento
- Um projeto no Supabase (ou outro PostgreSQL + S3) para o banco e os arquivos

## Instalação

```bash
pnpm install
```

Um único `pnpm install` na raiz instala as dependências de todos os projetos.

## Banco de dados, arquivos e Valkey

A API usa um PostgreSQL comum (com Drizzle) e um armazenamento de arquivos compatível com S3 (com o SDK oficial de S3). Nenhum código depende de fornecedor: trocar de provedor é só trocar variáveis de ambiente.

O banco e os arquivos ficam no Supabase em todos os ambientes, inclusive no desenvolvimento. Localmente, o Docker (`apps/api/docker-compose.yml`) roda só o [Valkey](https://valkey.io), o armazenamento em memória. A API roda fora do Docker.

O Valkey guarda as sessões do painel e vai servir para filas de tarefas em segundo plano (BullMQ), cache e controles de curta duração (limite de requisições, idempotência e travas). Ele roda com `maxmemory-policy noeviction`, que o BullMQ exige: por isso toda chave de cache precisa ter validade (TTL).

1. Crie o arquivo de variáveis de ambiente da API a partir do exemplo e preencha com os dados do Supabase (veja "Supabase" abaixo). O `.env` fica fora do Git.

```bash
cp apps/api/.env.example apps/api/.env
```

2. Suba o Valkey local.

```bash
pnpm services:up
```

3. Crie o usuário de aplicação no banco, aplique as migrações e, se quiser, crie os dois tenants de exemplo (`loja-aurora` e `loja-brisa`).

```bash
pnpm --filter api db:roles
pnpm --filter api db:migrate
pnpm --filter api db:seed
```

O `db:roles` vem antes das migrações porque elas dão permissões a esse usuário. Os três comandos podem rodar de novo sem efeito colateral.

4. Suba a API e confira a conexão com o banco e o Valkey em `http://localhost:3000/health`.

```bash
pnpm dev:api
```

Para alterar o banco, edite ou crie o esquema da tabela em `apps/api/src/database/schemas/` (um arquivo por tabela), registre as tabelas novas no objeto `schemas` de `apps/api/src/database/schema.ts`, gere a migração e aplique:

```bash
pnpm --filter api db:generate --name descricao_da_mudanca
pnpm --filter api db:migrate
```

As migrações geradas ficam em `apps/api/drizzle/` e são versionadas. Para derrubar o Valkey, use `pnpm services:down`; os dados continuam no volume do Docker.

### Os dois usuários do banco

A API não usa o dono das tabelas. São dois usuários:

- **Usuário de aplicação** (`feitio_app`, em `DATABASE_URL`): é com ele que a API se conecta. Não é dono de nenhuma tabela, não é superusuário e não pode ignorar a segurança por linha (RLS). Só alcança o que as migrações liberam para ele, uma tabela de cada vez. É criado pelo `db:roles`, com o nome e a senha que estão na própria `DATABASE_URL`; nenhuma senha vai para as migrações.
- **Usuário de migração** (o dono das tabelas, em `MIGRATION_DATABASE_URL`): roda o `db:roles`, o `db:migrate` e o `db:seed`. A API nunca o usa.

Cada lojista é um tenant, e o isolamento entre eles é garantido pelo próprio PostgreSQL: toda tabela de negócio tem a coluna `tenant_id` e regras de RLS que só deixam o usuário de aplicação ler e gravar linhas do tenant informado no início da transação. Fora desse contexto, nenhuma linha aparece. As rotas usadas pelas lojas e pelo checkout recebem o tenant no cabeçalho `X-Tenant` (o `slug` do lojista); por exemplo, `GET /store/settings` devolve o nome, o logo e o tema da loja.

A API não sobe sem `DATABASE_URL`, sem as variáveis `STORAGE_*`, sem `VALKEY_URL` nem sem `COOKIE_SECRET`. A especificação OpenAPI fica em `http://localhost:3000/openapi.json` e a documentação em `http://localhost:3000/docs`.

O código usa os arquivos pela interface `FileStorage` (`apps/api/src/storage/`), nunca pela implementação S3. O teste `pnpm --filter api test:e2e` envia, lê e remove arquivos de verdade no armazenamento configurado no `.env`, sempre num tenant aleatório que ele apaga no final.

### Variáveis de ambiente da API

Ficam em `apps/api/.env`; o modelo é o `apps/api/.env.example`.

| Variável | Obrigatória | Para que serve |
|---|---|---|
| `PORT` | não | Porta da API (padrão `3000`). |
| `DATABASE_URL` | sim | Conexão da API com o PostgreSQL, como usuário de aplicação (`feitio_app`). Pooler do Supabase em modo sessão, com TLS validado. A senha precisa ter pelo menos 16 caracteres; o `db:roles` cria o usuário com ela. |
| `MIGRATION_DATABASE_URL` | sim | Conexão como dono das tabelas, usada só por `db:roles`, `db:migrate` e `db:seed`. |
| `STORAGE_*` | sim | Armazenamento S3: endpoint, região, buckets, chaves e endereço público. |
| `VALKEY_URL` | sim | Conexão com o Valkey, no formato `redis://host:porta` (`redis://` é o nome do protocolo que o Valkey usa). Localmente, `redis://localhost:6379`. |
| `COOKIE_SECRET` | sim | Segredo que assina os cookies. Mínimo de 32 caracteres; gere com `openssl rand -base64 48`. Trocar o segredo invalida todas as sessões. |
| `SESSION_COOKIE_NAME` | não | Nome do cookie de sessão do painel (padrão `feitio_session`). |
| `SESSION_TTL_SECONDS` | não | Quanto tempo, em segundos, uma sessão vive sem uso (padrão `604800`, 7 dias). Cada requisição renova o prazo. |
| `SESSION_COOKIE_DOMAIN` | não | Domínio do cookie de sessão, por exemplo `.feitio.com.br` para valer em subdomínios. Vazio: só o host da API. |

O cookie de sessão é sempre `HttpOnly` e `SameSite=Lax`, e só trafega por HTTPS (`Secure`) quando `NODE_ENV=production`.

#### Organização dos arquivos

- **Dois buckets, por tipo de acesso, e não um por cliente.**
  - Público (`STORAGE_PUBLIC_BUCKET`): fotos de produto, logos e banners. Cada arquivo tem um endereço permanente, montado a partir de `STORAGE_PUBLIC_URL`.
  - Privado (`STORAGE_PRIVATE_BUCKET`): notas fiscais, relatórios e documentos. Os arquivos só são acessados por links temporários gerados pela API, que valem 15 minutos por padrão.
- **Caminho por lojista.** Dentro de cada bucket, os arquivos ficam em `tenants/{id-do-tenant}/{categoria}/{id-aleatório}.{extensão}`.
- **Quem monta o caminho é a API.** Quem envia informa o tenant, a categoria (letras minúsculas, números e hífen) e o tipo do arquivo; a extensão vem do tipo, nunca do nome enviado.
- **Tipos aceitos.** Público: `image/jpeg`, `image/png`, `image/webp` e `image/avif`. Privado: `application/pdf`, `text/csv`, `application/xml` e `text/xml`. HTML e SVG são recusados porque o navegador os executa como página; os links temporários do privado sempre forçam download. A lista fica em `apps/api/src/storage/file-types.ts` e deve bater com a configurada nos buckets do Supabase.
- **Domínio dos arquivos.** Os arquivos nunca podem ser servidos por um subdomínio da Feitio: um arquivo malicioso ali teria acesso aos cookies do painel e do checkout.
- **Remoção por lojista.** O módulo remove todos os arquivos de um tenant nos dois buckets.
- **Cache.** Atrás de uma CDN, como no Supabase, um arquivo público removido pode continuar acessível pelo endereço antigo até o cache expirar. Por isso o bucket público é só para o que pode ficar no ar por um tempo depois de apagado; o que precisa sumir na hora vai no privado.

### Supabase

O Supabase é usado só como PostgreSQL e como S3. Não há biblioteca do Supabase no projeto: basta preencher as variáveis de ambiente da API.

**Banco.** Use a string de conexão do pooler em modo sessão (Session pooler), que fica no painel do projeto em **Connect**. Pelo pooler, o usuário é `<usuário>.<project-ref>`: o de migração é o `postgres`, e o de aplicação é o `feitio_app`, com uma senha nova que você escolhe:

```bash
DATABASE_URL=postgresql://feitio_app.<project-ref>:<senha-do-app>@aws-0-<região>.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=certs/prod-ca-2021.crt
MIGRATION_DATABASE_URL=postgresql://postgres.<project-ref>:<senha>@aws-0-<região>.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=certs/prod-ca-2021.crt
```

O certificado (`prod-ca-2021.crt`) é baixado em **Database Settings → SSL Configuration** e fica em `apps/api/certs/`, fora do Git; o caminho é relativo a `apps/api`. Use a porta 5432 (modo sessão), nunca a 6543 (modo transação), que quebra o lock do `drizzle-kit migrate`. No driver `pg`, `sslmode=require` valida o certificado contra as CAs do sistema, e a CA do Supabase não está entre elas; por isso o `sslrootcert`. As duas variáveis usam o mesmo certificado.

**Arquivos.** Em **Storage**, crie dois buckets: um marcado como público e outro privado. Gere as chaves em **Storage → S3 Configuration → Access keys**:

```bash
STORAGE_ENDPOINT=https://<project-ref>.storage.supabase.co/storage/v1/s3
STORAGE_REGION=<região do projeto, ex.: sa-east-1>
STORAGE_PUBLIC_BUCKET=<nome do bucket público>
STORAGE_PRIVATE_BUCKET=<nome do bucket privado>
STORAGE_ACCESS_KEY_ID=<access key id>
STORAGE_SECRET_ACCESS_KEY=<secret access key>
STORAGE_PUBLIC_URL=https://<project-ref>.supabase.co/storage/v1/object/public/<nome do bucket público>
```

`STORAGE_PUBLIC_URL` é a base dos endereços públicos dos arquivos do bucket público; no Supabase ela é diferente do endpoint S3. Os links temporários do bucket privado são assinados pela própria API com as chaves S3.

## Comandos

Todos rodam a partir da raiz.

| Comando | O que faz |
|---|---|
| `pnpm dev` | Sobe API, painel e checkout ao mesmo tempo |
| `pnpm dev:api` | Sobe só a API |
| `pnpm services:up` | Sobe o Valkey de desenvolvimento no Docker |
| `pnpm services:down` | Derruba o Valkey de desenvolvimento, mantendo os dados |
| `pnpm dev:admin` | Sobe só o painel |
| `pnpm dev:checkout` | Sobe só o checkout |
| `pnpm dev:storefront` | Sobe só o storefront starter |
| `pnpm build` | Compila todos os projetos, na ordem de dependência |
| `pnpm test` | Roda os testes de todos os projetos |
| `pnpm check` | Verifica formatação e lint |
| `pnpm fix` | Corrige formatação e lint automaticamente |

Para rodar um comando em um projeto só:

```bash
pnpm --filter api test
pnpm --filter admin build
```

## Interfaces

O painel (`apps/admin`), o checkout (`apps/checkout`) e o projeto-base das lojas (`packages/storefront-starter`) usam a mesma stack:

- React, Vite e TypeScript, com o tsconfig de React do `@feitio/config`.
- TanStack Router com rotas por arquivo (`src/routes/`) e TanStack Query. O starter usa TanStack Start, com renderização no servidor; o painel e o checkout rodam só no navegador.
- Tailwind CSS, com componentes sobre o [Base UI](https://base-ui.com) (`@base-ui/react`) e ícones do [Phosphor](https://phosphoricons.com) (`@phosphor-icons/react`).
- `cn()` em `src/lib/cn.ts` (clsx + tailwind-merge) e variantes com `cva`.
- Vitest e Testing Library, com o `vitest.config.ts` de cada projeto.

O painel, o checkout e o starter foram criados com os geradores oficiais (`create-vite` no template React + TypeScript e `@tanstack/cli create`) e ajustados para o monorepo. Cada projeto tem os próprios componentes em `src/components/ui/`; não há pacote de componentes compartilhado.

### Tema

As cores e o arredondamento são variáveis CSS em `src/styles.css`, expostas ao Tailwind como cores do tema: `background`, `foreground`, `primary`, `primary-foreground`, `muted`, `muted-foreground`, `accent`, `border`, `destructive` e `radius`. Os componentes usam só classes do tema (`bg-primary`, `text-foreground`, `rounded-md`...); a paleta padrão do Tailwind é desligada, então `bg-red-500` nem existe.

- Painel e checkout: paleta da Feitio.
- Checkout: a paleta da Feitio é só o padrão. `applyTheme()` em `apps/checkout/src/theme.ts` é o ponto único onde as cores do lojista vão sobrescrever as variáveis ao carregar a página.
- Starter: valores neutros, substituídos pelo design de cada cliente.

### Cliente da API (Kubb)

Cada interface gera o próprio código de acesso à API: tipos, esquemas Zod, cliente `fetch` e hooks do TanStack Query. Com a API rodando:

```bash
pnpm --filter admin api:generate
```

O código vai para `src/api/gen/` e fica fora do Git. A URL da API vem de `VITE_API_URL` (veja o `.env.example` de cada projeto), e a da especificação de `OPENAPI_URL`, com padrão `http://localhost:3000/openapi.json`.

## Portas em desenvolvimento

| Projeto | Porta |
|---|---|
| API | 3000 |
| Painel | 3001 |
| Checkout | 3002 |
| Storefront starter | 3003 |
| Valkey | 6379 |

## Dependências

- Dependência de um projeto: instale no projeto.

```bash
  pnpm --filter api add nome-do-pacote
```

- Ferramenta usada por todos (Biome, Vitest, TypeScript): instale na raiz.

```bash
  pnpm add -Dw nome-do-pacote
```

- Pacote interno: use o protocolo `workspace`.

```bash
  pnpm --filter admin add -D "@feitio/config@workspace:*"
```

## Formatação e lint

O Biome fica instalado na raiz, com uma configuração única em `biome.json`.

- Indentação com tab, largura 4.
- Aspas duplas.
- Nas interfaces (admin, checkout e storefront-starter): regras de React e classes do Tailwind ordenadas automaticamente.
- Na API, a regra `useImportType` fica desligada, porque quebra a injeção de dependência do NestJS.

Rode `pnpm fix` antes de abrir um pull request.

## Testes

O Vitest fica instalado só na raiz. Cada projeto tem o próprio `vitest.config.ts` e o próprio script `test`.

- `pnpm test` na raiz roda os testes de todos os projetos.
- Para um projeto novo entrar, crie nele um `vitest.config.ts` com `name` e `include` apontando para a pasta `src` dele.

## CI

O arquivo `.github/workflows/ci.yml` roda em todo pull request e em todo envio para a `main`:

1. instala as dependências com o lockfile travado;
2. verifica formatação e lint (`biome ci`);
3. compila todos os projetos;
4. roda os testes.

A `main` é protegida: toda alteração entra por pull request, com o CI aprovado.

## Convenções

- Um módulo por domínio na API. Um módulo só acessa outro pelo serviço exportado.
- Só os repositories acessam o banco.
- Fornecedores externos (pagamento, frete, nota fiscal) ficam em `adapters/`, atrás de uma interface.
- A API usa módulos ES: os imports de arquivos locais terminam em `.js`.
- Diferença entre clientes é configuração por tenant, nunca código condicional.