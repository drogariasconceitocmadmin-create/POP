import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const CONFIG_DIR = path.resolve('config');
const OAUTH_CLIENT_PATH = path.join(CONFIG_DIR, 'oauth-client.json');
const TOKEN_PATH = path.join(CONFIG_DIR, 'token.json');

export const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
];

export function loadOAuthClient() {
  if (!fs.existsSync(OAUTH_CLIENT_PATH)) {
    throw new Error(
      `Arquivo não encontrado: ${OAUTH_CLIENT_PATH}\n` +
        'Baixe o OAuth Client (Desktop) e salve como config/oauth-client.json'
    );
  }

  const raw = JSON.parse(fs.readFileSync(OAUTH_CLIENT_PATH, 'utf8'));
  const cfg = raw.installed || raw.web;
  if (!cfg?.client_id || !cfg?.client_secret) {
    throw new Error('oauth-client.json inválido (esperado installed.client_id/client_secret)');
  }

  const oAuth2Client = new google.auth.OAuth2(
    cfg.client_id,
    cfg.client_secret,
    cfg.redirect_uris?.[0] || 'http://localhost'
  );

  return oAuth2Client;
}

export function saveToken(token) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), 'utf8');
}

export function loadToken() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
}

export async function getAuthedGoogle() {
  const auth = loadOAuthClient();
  const token = loadToken();
  if (!token) {
    throw new Error('Token não encontrado. Rode: npm run auth');
  }
  auth.setCredentials(token);

  return {
    auth,
    drive: google.drive({ version: 'v3', auth }),
    docs: google.docs({ version: 'v1', auth }),
    sheets: google.sheets({ version: 'v4', auth }),
  };
}

