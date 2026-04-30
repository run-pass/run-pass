import { v4 as uuidv4 } from 'uuid'
import { getEventsJson } from './locationMapping'
import type { EventsJson } from './locationMapping'
import type { ResolvedPassLocation } from './routeCoordinates'
import {
  resolvePassLocationsForPass,
  toGoogleMerchantLocation,
} from './routeCoordinates'

export const GOOGLE_WALLET_SAVE_URL_PREFIX = 'https://pay.google.com/gp/v/save/'
const DEFAULT_FRONTEND_URL = 'https://getrunpass.com'

type PassRequest = {
  barcode: string
  name?: string
  locations: string[]
}

type GoogleWalletSecrets = {
  GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL?: string
  GOOGLE_WALLET_SERVICE_ACCOUNT_PRIVATE_KEY?: string
  GOOGLE_WALLET_CLASS_ID?: string
  GOOGLE_WALLET_ALLOWED_ORIGINS?: string
  GOOGLE_WALLET_FRONTEND_URL?: string
}

type GoogleWalletConfig = {
  serviceAccountEmail?: string
  serviceAccountPrivateKey?: string
  classId?: string
  allowedOrigins: string[]
  frontendUrl: string
  missing: string[]
}

type GoogleWalletSaveLinkOptions = {
  secrets?: GoogleWalletSecrets
  eventsJsonLoader?: typeof getEventsJson
  signer?: (claims: Record<string, unknown>, privateKeyPem: string) => Promise<string>
  nowSeconds?: () => number
}

let googleWalletPrivateKeyPromise: Promise<CryptoKey> | undefined
let googleWalletPrivateKeyPem: string | undefined

function notEmpty<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

export function normalizeGoogleWalletOrigins(originsValue: string | undefined): string[] {
  if (!originsValue) {
    return []
  }

  return originsValue
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => {
      try {
        const normalized =
          value.includes('://') ? value : `https://${value.replace(/^\/+/, '')}`
        return new URL(normalized).host
      } catch {
        return value
      }
    })
}

export function getGoogleWalletConfig(
  source: GoogleWalletSecrets = globalThis as GoogleWalletSecrets,
): GoogleWalletConfig {
  const serviceAccountEmail = source.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL
  const serviceAccountPrivateKey = source.GOOGLE_WALLET_SERVICE_ACCOUNT_PRIVATE_KEY
  const classId = source.GOOGLE_WALLET_CLASS_ID
  const configuredAllowedOrigins = normalizeGoogleWalletOrigins(
    source.GOOGLE_WALLET_ALLOWED_ORIGINS,
  )
  const frontendUrl = source.GOOGLE_WALLET_FRONTEND_URL || DEFAULT_FRONTEND_URL
  const allowedOrigins =
    configuredAllowedOrigins.length > 0
      ? configuredAllowedOrigins
      : normalizeGoogleWalletOrigins(frontendUrl)

  const missing = [
    !serviceAccountEmail ? 'GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL' : null,
    !serviceAccountPrivateKey ? 'GOOGLE_WALLET_SERVICE_ACCOUNT_PRIVATE_KEY' : null,
    !classId ? 'GOOGLE_WALLET_CLASS_ID' : null,
  ].filter(notEmpty)

  return {
    serviceAccountEmail,
    serviceAccountPrivateKey,
    classId,
    allowedOrigins,
    frontendUrl,
    missing,
  }
}

function makeLocalizedString(value: string) {
  return {
    defaultValue: {
      language: 'en-GB',
      value,
    },
  }
}

function toBase64Url(input: Uint8Array): string {
  let binary = ''
  for (const byte of input) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function encodeUtf8Base64Url(value: string): string {
  return toBase64Url(new TextEncoder().encode(value))
}

function decodePemToBytes(pem: string): Uint8Array {
  const base64 = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function getGoogleWalletPrivateKey(privateKeyPem: string): Promise<CryptoKey> {
  if (!googleWalletPrivateKeyPromise || googleWalletPrivateKeyPem !== privateKeyPem) {
    googleWalletPrivateKeyPem = privateKeyPem
    googleWalletPrivateKeyPromise = crypto.subtle.importKey(
      'pkcs8',
      decodePemToBytes(privateKeyPem),
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      false,
      ['sign'],
    )
  }

  return googleWalletPrivateKeyPromise
}

export async function signJwt(
  claims: Record<string, unknown>,
  privateKeyPem: string,
): Promise<string> {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  }

  const encodedHeader = encodeUtf8Base64Url(JSON.stringify(header))
  const encodedClaims = encodeUtf8Base64Url(JSON.stringify(claims))
  const signingInput = `${encodedHeader}.${encodedClaims}`

  const key = await getGoogleWalletPrivateKey(privateKeyPem)
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(signingInput),
  )

  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`
}

export function buildGoogleWalletObject(
  passRequest: PassRequest,
  classId: string,
  frontendUrl: string,
  resolvedLocations: ResolvedPassLocation[],
) {
  const textModulesData = [
    {
      id: 'parkrun-id',
      header: 'parkrun ID number',
      body: passRequest.barcode,
    },
    ...(passRequest.name
      ? [
          {
            id: 'runner-name',
            header: 'Runner name',
            body: passRequest.name,
          },
        ]
      : []),
    ...(resolvedLocations.length
      ? [
          {
            id: 'local-runs',
            header: 'Local parkruns',
            body: `${resolvedLocations.length} locations configured`,
          },
        ]
      : []),
  ]

  return {
    id: `${classId.split('.')[0]}.runpass-${uuidv4()}`,
    classId,
    state: 'ACTIVE',
    cardTitle: makeLocalizedString('getrunpass.com'),
    header: makeLocalizedString(passRequest.name || 'parkrun barcode'),
    ...(passRequest.name
      ? { subheader: makeLocalizedString('parkrun barcode') }
      : {}),
    hexBackgroundColor: '#495d4e',
    barcode: {
      type: 'CODE_128',
      value: passRequest.barcode,
      alternateText: passRequest.barcode,
    },
    textModulesData,
    linksModuleData: {
      uris: [
        {
          uri: frontendUrl,
          description: 'getrunpass.com',
        },
        {
          uri: 'https://github.com/run-pass/run-pass',
          description: 'Source code',
        },
      ],
    },
    ...(resolvedLocations.length
      ? {
          merchantLocations: resolvedLocations.map(toGoogleMerchantLocation),
        }
      : {}),
  }
}

export function buildGoogleWalletClaims(
  passRequest: PassRequest,
  config: GoogleWalletConfig,
  resolvedLocations: ResolvedPassLocation[],
  now: number,
) {
  return {
    iss: config.serviceAccountEmail!,
    aud: 'google',
    typ: 'savetowallet',
    iat: now,
    exp: now + 60 * 60,
    origins: config.allowedOrigins,
    payload: {
      genericObjects: [
        buildGoogleWalletObject(
          passRequest,
          config.classId!,
          config.frontendUrl,
          resolvedLocations,
        ),
      ],
    },
  }
}

export async function buildGoogleWalletSaveLink(
  passRequest: PassRequest,
  options: GoogleWalletSaveLinkOptions = {},
): Promise<string> {
  const googleWalletConfig = getGoogleWalletConfig(options.secrets)

  if (googleWalletConfig.missing.length) {
    throw new Error(
      `Google Wallet is not configured. Missing secrets: ${googleWalletConfig.missing.join(
        ', ',
      )}`,
    )
  }

  const loadEventsJson = options.eventsJsonLoader || getEventsJson
  const now = options.nowSeconds ? options.nowSeconds() : Math.floor(Date.now() / 1000)
  const { data: eventsJson } = await loadEventsJson()
  const resolvedLocations = await resolvePassLocationsForPass(
    passRequest.locations,
    eventsJson as EventsJson,
  )
  const claims = buildGoogleWalletClaims(
    passRequest,
    googleWalletConfig,
    resolvedLocations,
    now,
  )

  const jwt = await (options.signer || signJwt)(
    claims,
    googleWalletConfig.serviceAccountPrivateKey!,
  )
  return `${GOOGLE_WALLET_SAVE_URL_PREFIX}${jwt}`
}
