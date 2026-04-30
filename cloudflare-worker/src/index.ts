import { Buffer } from 'buffer'
import { PKPass } from 'passkit-generator'
import { v4 as uuidv4 } from 'uuid'
import icon from './assets/icon.png'
import { pass } from './assets/pass'
import wwdrpem from './assets/wwdr.pem'
import { Router } from 'itty-router'
import { getEventsJson } from './locationMapping'
import { buildGoogleWalletSaveLink } from './googleWallet'
import {
  resolvePassLocationsForPass,
  toApplePassLocation,
} from './routeCoordinates'

const secrets = globalThis as any

const wwdr = wwdrpem
const signerCert = secrets.SIGNER_CERT
const signerKey = secrets.SIGNER_KEY
const signerKeyPassphrase = secrets.SIGNER_KEY_PASSPHRASE

const router = Router()

type PassRequest = {
  barcode: string
  name?: string
  locations: string[]
}

function parsePassRequest(reqUrl: URL): PassRequest {
  const rawBarcode = reqUrl.searchParams.get('barcode')
  const rawName = reqUrl.searchParams.get('name')
  const barcode = rawBarcode ? rawBarcode.trim() : undefined
  const name = rawName && rawName.trim() ? rawName.trim() : undefined
  const locations = reqUrl.searchParams
    .getAll('locations')
    .map(loc => loc.trim())
    .filter(Boolean)

  if (!barcode) {
    throw new Error('Missing required query param: barcode')
  }

  return { barcode, name, locations }
}

// attach the router "handle" to the event handler
addEventListener('fetch', event =>
  event.respondWith(router.handle(event.request)),
)

router.get('/github', ({ url }) => {
  return Response.redirect('https://github.com/run-pass/run-pass/', 307)
})

router.get('/passbook', async ({ url }) => {
  const reqUrl = new URL(url)
  const { barcode, name, locations } = parsePassRequest(reqUrl)

  try {
    const { data: eventsJson } = await getEventsJson()
    const resolvedLocations = await resolvePassLocationsForPass(
      locations,
      eventsJson,
    )

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
      ...resolvedLocations.map(toApplePassLocation),
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

router.get('/google-wallet', async ({ url }) => {
  try {
    const passRequest = parsePassRequest(new URL(url))
    const saveLink = await buildGoogleWalletSaveLink(passRequest)

    return Response.redirect(saveLink, 302)
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to create Google Wallet link'
    const status =
      message.startsWith('Missing required query param') ||
      message.startsWith('Google Wallet is not configured')
        ? 400
        : 500

    return new Response(message, { status })
  }
})

// 404 for everything else
router.all('*', () => new Response('Not Found.', { status: 404 }))
