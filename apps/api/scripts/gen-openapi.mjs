// Gera docs/openapi.yaml a partir das rotas declaradas em src/app.ts (uso: npm run openapi).
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
const re = /app\.(get|post|put|patch|delete)\(\s*(['"/][^,]*?)\s*,\s*([^\n]*)/g;
const routes = [];
for (const m of src.matchAll(re)) {
  let path = m[2].trim();
  if (!/^['"]\//.test(path)) continue; // ignora o fallback da interface (regex)
  path = path.slice(1, -1).replace(/:([A-Za-z]+)/g, '{$1}');
  const rest = m[3];
  const roles = [...(/staff(?:Any)?\(([^)]*)\)/.exec(rest)?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
  const secured = /staff|authenticate/.test(rest);
  routes.push({ method: m[1], path, roles, secured, pending: /staffAny/.test(rest) });
}

const tag = (p) => (p.split('/')[1] === 'public' ? 'público' : p.split('/')[1]);
const by = {};
for (const r of routes) (by[r.path] ??= []).push(r);

let y = `openapi: 3.0.3
info:
  title: Bilhete+ API
  version: 0.1.0
  description: |
    Gerado automaticamente a partir das rotas (\`npm run openapi\`). Valores monetários em **centavos inteiros** (string ou número).
    Autenticação: \`Authorization: Bearer <token>\` obtido em \`POST /auth/login\`. As rotas indicam as funções permitidas.
    Os pedidos de pagamento aceitam \`idempotencyKey\`: repetir o mesmo pedido nunca debita duas vezes.
servers: [{ url: / }]
components:
  securitySchemes:
    bearer: { type: http, scheme: bearer }
paths:
`;
for (const [path, list] of Object.entries(by).sort(([a], [b]) => a.localeCompare(b))) {
  y += `  ${path}:\n`;
  const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  for (const r of list) {
    y += `    ${r.method}:\n      tags: [${tag(path)}]\n      operationId: ${r.method}_${path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}\n`;
    const note = r.roles.length ? `Funções: ${r.roles.join(', ')}.` : r.secured ? 'Qualquer utilizador autenticado.' : 'Público.';
    y += `      description: "${note}${r.pending ? ' Disponível também a empresas ainda pendentes de aprovação.' : ''}"\n`;
    if (r.secured) y += `      security: [{ bearer: [] }]\n`;
    if (params.length) y += `      parameters:\n` + params.map((p) => `        - { name: ${p}, in: path, required: true, schema: { type: string } }\n`).join('');
    y += `      responses:\n        '200': { description: OK }\n        '400': { description: Dados inválidos }\n${r.secured ? "        '401': { description: Não autenticado }\n        '403': { description: Sem permissão ou empresa não aprovada }\n        '404': { description: Não encontrado (inclui recursos de outra empresa) }\n" : ''}`;
  }
}
writeFileSync(new URL('../../../docs/openapi.yaml', import.meta.url), y);
console.log(`openapi.yaml: ${routes.length} operações em ${Object.keys(by).length} caminhos`);
