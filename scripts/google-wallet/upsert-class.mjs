#!/usr/bin/env node

import { GoogleAuth } from 'google-auth-library';
import { walletobjects } from '@googleapis/walletobjects';

const WALLET_OBJECTS_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';

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

function isNotFound(error) {
  return error && typeof error === 'object' && error.code === 404;
}

async function createWalletClient(serviceAccountJsonPath) {
  const auth = new GoogleAuth({
    keyFile: serviceAccountJsonPath,
    scopes: [WALLET_OBJECTS_SCOPE],
  });
  const authClient = await auth.getClient();

  return walletobjects({
    version: 'v1',
    auth: authClient,
  });
}

async function getGenericClass(client, classId) {
  try {
    const response = await client.genericclass.get({ resourceId: classId });
    return response.data;
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }

    throw error;
  }
}

async function main() {
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
  const classId = `${issuerId}.${classSuffix}`;

  const client = await createWalletClient(serviceAccountJsonPath);
  const existingClass = await getGenericClass(client, classId);

  if (!existingClass) {
    const response = await client.genericclass.insert({
      requestBody: {
        id: classId,
        reviewStatus,
      },
    });
    const created = response.data;

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
