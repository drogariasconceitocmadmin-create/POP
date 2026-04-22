import http from 'node:http';
import { URL } from 'node:url';
import open from 'open';
import { loadOAuthClient, saveToken, SCOPES } from './googleClient.js';

function pickFreePort(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('Não foi possível obter porta.'));
      resolve(addr.port);
    });
  });
}

async function main() {
  const auth = loadOAuthClient();

  const server = http.createServer();
  server.on('request', async (req, res) => {
    try {
      const u = new URL(req.url || '/', 'http://localhost');
      if (u.pathname !== '/oauth2callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const code = u.searchParams.get('code');
      if (!code) {
        res.writeHead(400);
        res.end('Missing code');
        return;
      }

      const { tokens } = await auth.getToken(code);
      saveToken(tokens);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Autenticação concluída. Você pode fechar esta aba e voltar ao terminal.');
      server.close();
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String(e?.stack || e));
      server.close();
    }
  });

  const port = await pickFreePort(server);
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  auth.redirectUri = redirectUri;

  const authUrl = auth.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    redirect_uri: redirectUri,
  });

  console.log('Abrindo navegador para autenticação...');
  await open(authUrl);
  console.log(`Se não abrir automaticamente, copie e cole no navegador:\n${authUrl}`);
  console.log('Aguardando callback...');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

