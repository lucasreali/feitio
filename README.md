# feitio-core

Núcleo da plataforma Feitio: a API, o painel do lojista, o checkout e os pacotes compartilhados que as lojas dos clientes usam.

As lojas dos clientes não ficam aqui. Cada uma tem o próprio repositório, criado a partir do `storefront-starter`.

As interfaces (painel, checkout e lojas) acessam a API por código gerado: cada uma gera o próprio cliente com o [Kubb](https://kubb.dev), a partir da especificação OpenAPI (Swagger) que a API publica.

## Estrutura

```text
feitio-core/
├── apps/
│   ├── api/                  # API multitenant (NestJS + Fastify + Drizzle)
│   ├── admin/                # painel do lojista (Vite + React + TanStack Router + TanStack Query + Tailwind, só no navegador)
│   └── checkout/             # checkout único de todas as lojas (Vite + React + TanStack Router + TanStack Query + Tailwind, só no navegador)
├── packages/
│   ├── storefront-starter/   # projeto-base das lojas, sem telas (TanStack Start, com renderização no servidor)
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
- Docker com Docker Compose, para o banco de dados de desenvolvimento

## Instalação

```bash
pnpm install
```

Um único `pnpm install` na raiz instala as dependências de todos os projetos.

## Banco de dados

A API usa PostgreSQL 18 com Drizzle. Em desenvolvimento, o banco roda no Docker (`apps/api/docker-compose.yml`); a API roda fora dele.

1. Crie o arquivo de variáveis de ambiente da API a partir do exemplo. O `.env` fica fora do Git.

```bash
cp apps/api/.env.example apps/api/.env
```

2. Suba o banco. O comando espera o Postgres ficar pronto.

```bash
pnpm db:up
```

3. Aplique as migrações.

```bash
pnpm --filter api db:migrate
```

4. Suba a API e confira a conexão em `http://localhost:3000/health`.

```bash
pnpm dev:api
```

Para alterar o banco, edite ou crie o esquema da tabela em `apps/api/src/database/schemas/` (um arquivo por tabela), registre as tabelas novas no objeto `schemas` de `apps/api/src/database/schema.ts`, gere a migração e aplique:

```bash
pnpm --filter api db:generate --name descricao_da_mudanca
pnpm --filter api db:migrate
```

As migrações geradas ficam em `apps/api/drizzle/` e são versionadas. Para derrubar o banco, use `pnpm db:down`; os dados continuam no volume do Docker.

A API não sobe sem `DATABASE_URL`. A especificação OpenAPI fica em `http://localhost:3000/openapi.json` e a documentação em `http://localhost:3000/docs`.

## Comandos

Todos rodam a partir da raiz.

| Comando | O que faz |
|---|---|
| `pnpm dev` | Sobe API, painel e checkout ao mesmo tempo |
| `pnpm dev:api` | Sobe só a API |
| `pnpm db:up` | Sobe o banco de desenvolvimento da API (Docker) |
| `pnpm db:down` | Derruba o banco de desenvolvimento, mantendo os dados |
| `pnpm dev:admin` | Sobe só o painel |
| `pnpm dev:checkout` | Sobe só o checkout |
| `pnpm build` | Compila todos os projetos, na ordem de dependência |
| `pnpm test` | Roda os testes de todos os projetos |
| `pnpm check` | Verifica formatação e lint |
| `pnpm fix` | Corrige formatação e lint automaticamente |

Para rodar um comando em um projeto só:

```bash
pnpm --filter api test
pnpm --filter admin build
```

## Portas em desenvolvimento

| Projeto | Porta |
|---|---|
| API | 3000 |
| Painel | 3001 |
| Checkout | 3002 |
| Storefront starter | 3003 |

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