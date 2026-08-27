import { Buffer } from 'buffer'
import { Hono } from 'hono'
import { PKPass } from 'passkit-generator'
import icon from './assets/icon.png'
import { pass } from './assets/pass'
import wwdr from './assets/wwdr.pem'
import type { Env } from './bindings'
import { getEventsJson } from './locationMapping'
import {
  resolvePassLocationsForPass,
  toApplePassLocation,
} from './routeCoordinates'

type AppBindings = {
  Bindings: Env
}

function parsePassbookRequest(reqUrl: URL) {
  const barcode = reqUrl.searchParams.get('barcode') || ''
  const name = reqUrl.searchParams.get('name') || undefined
  const locations = reqUrl.searchParams
    .getAll('locations')
    .map(loc => loc.trim())
    .filter(Boolean)

  return { barcode, name, locations }
}

const app = new Hono<AppBindings>()

app.get('/github', c => c.redirect('https://github.com/run-pass/run-pass/', 307))

app.get('/passbook', async c => {
  const { barcode, name, locations } = parsePassbookRequest(new URL(c.req.url))
  const { data: eventsJson } = await getEventsJson()
  const resolvedLocations = await resolvePassLocationsForPass(
    locations,
    eventsJson,
  )

  if (c.env.RUNPASS_TEST_PKPASS) {
    return new Response(c.env.RUNPASS_TEST_PKPASS, {
      headers: { 'Content-Type': 'application/vnd.apple.pkpass' },
    })
  }

  const passObj = new PKPass(
    {
      'pass.json': Buffer.from(
        JSON.stringify(pass(barcode, c.env, locations, name)),
        'utf-8',
      ),
      'icon.png': Buffer.from(icon),
      thumbnail: Buffer.from(icon),
    },
    {
      wwdr,
      signerCert: c.env.SIGNER_CERT,
      signerKey: c.env.SIGNER_KEY,
      signerKeyPassphrase: c.env.SIGNER_KEY_PASSPHRASE,
    },
    {
      serialNumber: crypto.randomUUID(),
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
})

app.get('/events.json', async c => {
  const { data, etag } = await getEventsJson()
  const reqEtag = c.req.header('if-none-match')

  if (etag && reqEtag === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        'Access-Control-Allow-Origin': '*',
        ...(etag ? { ETag: etag } : {}),
      },
    })
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...(etag ? { ETag: etag } : {}),
    },
  })
})

app.notFound(() => new Response('Not Found.', { status: 404 }))

export default app
