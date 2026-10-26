import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = 'http://localhost:4100';
const paths = ['/auth', '/public', '/events', '/orgs', '/org', '/users', '/pos', '/tickets', '/merchants', '/refund-requests', '/me', '/webhooks'];
export default defineConfig({
  plugins: [react()],
  server: { port: 5180, proxy: Object.fromEntries(paths.map((p) => [p, api])) },
});
