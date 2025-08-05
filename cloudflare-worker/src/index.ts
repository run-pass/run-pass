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

  const barcode = reqUrl.searchParams.get('barcode')!
  const name = reqUrl.searchParams.get('name')!
  const locations: string[] = [reqUrl.searchParams.getAll('locations')].flat()

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
