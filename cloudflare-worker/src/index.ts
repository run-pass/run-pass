import { Buffer } from 'buffer'
import { PKPass } from 'passkit-generator'
import { parkRunLocationData } from '../../frontend/src/assets/park_runs'
import { v4 as uuidv4 } from 'uuid'
import icon from './assets/icon.png'
import { pass } from './assets/pass'
import wwdrpem from './assets/wwdr.pem'
import { Router } from 'itty-router'

const secrets = globalThis as any

const wwdr = wwdrpem
const signerCert = secrets.SIGNER_CERT
const signerKey = secrets.SIGNER_KEY
const signerKeyPassphrase = secrets.SIGNER_KEY_PASSPHRASE

const locationMapping = Object.fromEntries(
  parkRunLocationData.map(d => [d.properties.eventname, d]),
)

const router = Router()

// attach the router "handle" to the event handler
addEventListener('fetch', event =>
  event.respondWith(router.handle(event.request)),
)

router.get('/github', ({ url }) => {
  return Response.redirect('https://github.com/run-pass/run-pass/', 307)
})

router.get('/passbook', ({ url }) => {
  const reqUrl = new URL(url)

  const barcode = reqUrl.searchParams.get('barcode')!
  const name = reqUrl.searchParams.get('name')!
  const locations: string[] = [reqUrl.searchParams.getAll('locations')].flat()

  try {
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

router.get('/events.json', async () => {
  const response = await fetch('https://images.parkrun.com/events.json', {
    cache: 'default',
    credentials: 'omit',
    headers: {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'en-GB,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Priority': 'u=3, i',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15',
    },
    method: 'GET',
    mode: 'cors',
    redirect: 'follow',
    referrer: 'https://www.parkrun.com/',
    referrerPolicy: 'strict-origin-when-cross-origin',
  })
  const data = await response.text()
  return new Response(data, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') || 'application/json',
    },
  })
})

// 404 for everything else
router.all('*', () => new Response('Not Found.', { status: 404 }))
