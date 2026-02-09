import { Buffer } from 'buffer'
import { PKPass } from 'passkit-generator'
import { v4 as uuidv4 } from 'uuid'
import icon from './assets/icon.png'
import { pass } from './assets/pass'
import wwdrpem from './assets/wwdr.pem'
import { Router } from 'itty-router'
import { getLocationMapping, getEventsJson } from './locationMapping'

const secrets = globalThis as any

const wwdr = wwdrpem
const signerCert = secrets.SIGNER_CERT
const signerKey = secrets.SIGNER_KEY
const signerKeyPassphrase = secrets.SIGNER_KEY_PASSPHRASE

const router = Router()

// attach the router "handle" to the event handler
addEventListener('fetch', event =>
  event.respondWith(router.handle(event.request)),
)

router.get('/github', ({ url }) => {
  return Response.redirect('https://github.com/run-pass/run-pass/', 307)
})

router.get('/passbook', async ({ url }) => {
  const reqUrl = new URL(url)

  const barcode = reqUrl.searchParams.get('barcode')
  const name = reqUrl.searchParams.get('name') || ''
  const locations = reqUrl.searchParams.getAll('locations')
  if (!barcode) {
    return new Response('Missing barcode query parameter', { status: 400 })
  }

  try {
    const locationMapping = await getLocationMapping()

    const passObj = new PKPass(
      {
        'pass.json': Buffer.from(
          JSON.stringify(pass(barcode, locations, name)),
          'utf-8',
        ),
        'icon.png': Buffer.from(icon),
        thumbnail: Buffer.from(icon),
      },
      {
        wwdr,
        signerCert,
        signerKey,
        signerKeyPassphrase,
      },
      {
        serialNumber: uuidv4(),
      },
    )

    passObj.setLocations(
      ...locations
        .map(locId => locationMapping[locId])
        .filter(Boolean)
        .map(location => ({
          longitude: location.geometry.coordinates[0],
          latitude: location.geometry.coordinates[1],
          relevantText: location.properties.EventLongName,
        })),
    )
    passObj.setBarcodes(
      {
        format: 'PKBarcodeFormatCode128',
        message: barcode,
        messageEncoding: 'iso-8859-1',
        altText: barcode,
      },
      {
        format: 'PKBarcodeFormatQR',
        message: barcode,
        messageEncoding: 'iso-8859-1',
        altText: barcode,
      },
    )

    return new Response(passObj.getAsBuffer(), {
      headers: { 'Content-Type': 'application/vnd.apple.pkpass' },
    })
  } catch (err) {
    throw err
  }
})

router.get('/google-wallet', async ({ url }) => {
  const reqUrl = new URL(url)

  const barcode = reqUrl.searchParams.get('barcode')
  const name = reqUrl.searchParams.get('name') || ''
  const locations = reqUrl.searchParams.getAll('locations')

  if (!barcode) {
    return new Response('Missing barcode query parameter', { status: 400 })
  }

  const walletConfig = getGoogleWalletConfig()
  if (!walletConfig) {
    return new Response('Google Wallet is not configured', { status: 500 })
  }

  const locationMapping = await getLocationMapping()
  const merchantLocations = locations
    .map(locId => locationMapping[locId])
    .filter(Boolean)
    .slice(0, 10)
    .map(location => ({
      latitude: location.geometry.coordinates[1],
      longitude: location.geometry.coordinates[0],
    }))

  const objectId = `${walletConfig.issuerId}.runpass-${sanitizeForObjectId(barcode)}-${uuidv4()}`
  const genericObject: any = {
    id: objectId,
    classId: walletConfig.classId,
    state: 'ACTIVE',
    cardTitle: localizedString('parkrun'),
    header: localizedString(name || 'parkrun barcode'),
    subheader: localizedString(barcode),
    barcode: {
      type: 'CODE_128',
      value: barcode,
      alternateText: barcode,
    },
    textModulesData: [
      {
        id: 'parkrun-id',
        header: 'parkrun ID',
        body: barcode,
      },
    ],
  }

  if (merchantLocations.length > 0) {
    genericObject.merchantLocations = merchantLocations
  }

  const payload = {
    iss: walletConfig.serviceAccountEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: walletConfig.origins,
    payload: {
      genericObjects: [genericObject],
    },
  }

  const jwt = await signJwt(payload, walletConfig.privateKey)
  return Response.redirect(`https://pay.google.com/gp/v/save/${jwt}`, 302)
})

router.get('/events.json', async (req) => {
  const { data, etag } = await getEventsJson();
  const reqEtag = (req as any).headers.get('if-none-match');
  if (etag && reqEtag === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        'Access-Control-Allow-Origin': '*',
        ...(etag ? { 'ETag': etag } : {}),
      },
    });
  }
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...(etag ? { 'ETag': etag } : {}),
    },
  });
});

// 404 for everything else
router.all('*', () => new Response('Not Found.', { status: 404 }))

const localizedString = (value: string) => ({
  defaultValue: {
    language: 'en-US',
    value,
  },
})

const sanitizeForObjectId = (value: string): string =>
  value.replace(/[^A-Za-z0-9._-]/g, '-')

const getGoogleWalletConfig = () => {
  const issuerId = secrets.GW_ISSUER_ID
  const rawClassId = secrets.GW_CLASS_ID
  const serviceAccountEmail = secrets.GW_SERVICE_ACCOUNT_EMAIL
  const privateKey = normalizePem(secrets.GW_PRIVATE_KEY)
  const origins = parseOrigins(secrets.GW_ORIGINS)

  if (!issuerId || !rawClassId || !serviceAccountEmail || !privateKey || !origins.length) {
    return null
  }

  return {
    issuerId,
    classId: rawClassId.includes('.') ? rawClassId : `${issuerId}.${rawClassId}`,
    serviceAccountEmail,
    privateKey,
    origins,
  }
}

const parseOrigins = (originsRaw: string | undefined): string[] => {
  if (!originsRaw) {
    return ['getrunpass.com']
  }

  return originsRaw
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(origin => origin.replace(/^https?:\/\//, '').replace(/\/$/, ''))
}

const normalizePem = (pem: string | undefined): string =>
  (pem || '').replace(/\\n/g, '\n')

const pemToArrayBuffer = (pem: string): ArrayBuffer => {
  const cleanPem = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '')

  const keyData = Buffer.from(cleanPem, 'base64')
  return keyData.buffer.slice(
    keyData.byteOffset,
    keyData.byteOffset + keyData.byteLength,
  )
}

const toBase64Url = (value: string | ArrayBuffer): string => {
  const bufferValue =
    typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value)
  return bufferValue
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

const signJwt = async (payload: Record<string, any>, privateKeyPem: string) => {
  const encodedHeader = toBase64Url(
    JSON.stringify({
      alg: 'RS256',
      typ: 'JWT',
    }),
  )
  const encodedPayload = toBase64Url(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  )

  return `${signingInput}.${toBase64Url(signature)}`
}
