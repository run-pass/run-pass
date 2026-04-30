#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }

    args[key] = next;
    i += 1;
  }

  return args;
}

function getArg(args, name, fallback) {
  return args[name] ?? process.env[name.replace(/-/g, '_').toUpperCase()] ?? fallback;
}

function required(value, label) {
  if (!value) {
    throw new Error(`Missing required value: ${label}`);
  }
  return value;
}

function base64UrlEncode(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signJwt(header, claims, privateKey) {
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaims = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedClaims}`;

  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey);

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let parsed;

  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    const message = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
    throw new Error(`HTTP ${response.status} ${response.statusText}\n${message}`);
  }

  return parsed;
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    serviceAccount.private_key,
  );

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const tokenResponse = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  return tokenResponse.access_token;
}

function authHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function getGenericClass(accessToken, classId) {
  const endpoint = `https://walletobjects.googleapis.com/walletobjects/v1/genericClass/${encodeURIComponent(classId)}`;
  const response = await fetch(endpoint, {
    headers: authHeaders(accessToken),
  });

  if (response.status === 404) {
    return null;
  }

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    const message = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
    throw new Error(`HTTP ${response.status} ${response.statusText}\n${message}`);
  }

  return parsed;
}

async function createGenericClass(accessToken, payload) {
  return fetchJson('https://walletobjects.googleapis.com/walletobjects/v1/genericClass', {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(payload),
  });
}

async function main() {
  if (typeof fetch !== 'function') {
    throw new Error('Node.js 18+ is required (global fetch is missing).');
  }

  const args = parseArgs(process.argv.slice(2));

  const serviceAccountJsonPath = required(
    getArg(args, 'service-account-json'),
    '--service-account-json (or SERVICE_ACCOUNT_JSON)',
  );
  const issuerId = required(
    getArg(args, 'issuer-id'),
    '--issuer-id (or ISSUER_ID)',
  );
  const classSuffix = getArg(args, 'class-suffix', 'runpass.parkrun');
  const reviewStatus = getArg(args, 'review-status', 'UNDER_REVIEW');

  const rawServiceAccount = await readFile(serviceAccountJsonPath, 'utf8');
  const serviceAccount = JSON.parse(rawServiceAccount);

  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error(`Service account JSON is missing client_email/private_key: ${serviceAccountJsonPath}`);
  }

  const classId = `${issuerId}.${classSuffix}`;
  const accessToken = await getAccessToken(serviceAccount);
  const existingClass = await getGenericClass(accessToken, classId);

  if (!existingClass) {
    const created = await createGenericClass(accessToken, {
      id: classId,
      reviewStatus,
    });

    console.log(`Created Google Wallet Generic class: ${created.id ?? classId}`);
    console.log(`Review status: ${created.reviewStatus ?? reviewStatus}`);
    console.log('Note: production use still requires Google Wallet publishing approval.');
    return;
  }

  console.log(`Google Wallet Generic class already exists: ${classId}`);
  if (existingClass.reviewStatus) {
    console.log(`Current review status: ${existingClass.reviewStatus}`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
