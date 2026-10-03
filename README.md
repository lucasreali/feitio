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
- Docker com Docker Compose, para o banco e o armazenamento de arquivos de desenvolvimento

## Instalação

```bash
pnpm install
```

Um único `pnpm install` na raiz instala as dependências de todos os projetos.

## Banco de dados e arquivos

A API usa um PostgreSQL comum (com Drizzle) e um armazenamento de arquivos compatível com S3 (com o SDK oficial de S3). Nenhum código depende de fornecedor: trocar de provedor é só trocar variáveis de ambiente.

Em desenvolvimento, os dois rodam no Docker (`apps/api/docker-compose.yml`): PostgreSQL 18 e [RustFS](https://rustfs.com), um servidor compatível com S3. A API roda fora do Docker.

1. Crie o arquivo de variáveis de ambiente da API a partir do exemplo. O `.env` fica fora do Git.

```bash
cp apps/api/.env.example apps/api/.env
```

2. Suba os serviços locais. O comando espera o Postgres ficar pronto e cria os dois buckets de arquivos.

```bash
pnpm services:up
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

As migrações geradas ficam em `apps/api/drizzle/` e são versionadas. Para derrubar os serviços, use `pnpm services:down`; os dados continuam nos volumes do Docker.

A API não sobe sem `DATABASE_URL` nem sem as variáveis `STORAGE_*`. A especificação OpenAPI fica em `http://localhost:3000/openapi.json` e a documentação em `http://localhost:3000/docs`.

O código usa os arquivos pela interface `FileStorage` (`apps/api/src/storage/`), nunca pela implementação S3. O teste `pnpm --filter api test:e2e` envia, lê e remove arquivos no armazenamento local, então precisa dos serviços no ar.

#### Organização dos arquivos

- **Dois buckets, por tipo de acesso, e não um por cliente.**
  - Público (`STORAGE_PUBLIC_BUCKET`): fotos de produto, logos e banners. Cada arquivo tem um endereço permanente, montado a partir de `STORAGE_PUBLIC_URL`.
  - Privado (`STORAGE_PRIVATE_BUCKET`): notas fiscais, relatórios e documentos. Os arquivos só são acessados por links temporários gerados pela API, que valem 15 minutos por padrão.
- **Caminho por lojista.** Dentro de cada bucket, os arquivos ficam em `tenants/{id-do-tenant}/{categoria}/{id-aleatório}.{extensão}`.
- **Quem monta o caminho é a API.** Quem envia informa o tenant, a categoria (letras minúsculas, números e hífen) e o nome original, do qual só a extensão é aproveitada.
- **Remoção por lojista.** O módulo remove todos os arquivos de um tenant nos dois buckets.

### Produção com Supabase

Em produção, o Supabase é usado só como PostgreSQL e como S3. Não há biblioteca do Supabase no projeto: basta preencher as variáveis de ambiente da API.

**Banco.** Use a string de conexão do pooler em modo sessão (Session pooler), que fica no painel do projeto em **Connect**:

```bash
DATABASE_URL=postgresql://postgres.<project-ref>:<senha>@aws-0-<região>.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/caminho/prod-ca-2021.crt
```

O certificado (`prod-ca-2021.crt`) é baixado em **Database Settings → SSL Configuration**. No driver `pg`, `sslmode=require` valida o certificado contra as CAs do sistema, e a CA do Supabase não está entre elas; por isso o `sslrootcert`. A mesma variável serve para o `pnpm --filter api db:migrate`.

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
| `pnpm services:up` | Sobe o banco e o armazenamento de arquivos de desenvolvimento (Docker) |
| `pnpm services:down` | Derruba os serviços de desenvolvimento, mantendo os dados |
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
| PostgreSQL | 5432 |
| Armazenamento S3 (RustFS) | 9000 |

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