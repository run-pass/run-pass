import { SELF, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/bindings'
import worker from '../src/index'
import {
  GOOGLE_WALLET_SAVE_URL_PREFIX,
  buildGoogleWalletClaims,
  buildGoogleWalletObject,
  getGoogleWalletConfig,
  normalizeGoogleWalletOrigins,
} from '../src/googleWallet'
import { resetEventsJsonCache } from '../src/locationMapping'
import {
  extractMapFromCourseHtml,
  parseKmlRouteMetadata,
  resolveEventPassLocation,
  resolvePassLocationsForPass,
  toApplePassLocation,
  toGoogleMerchantLocation,
} from '../src/routeCoordinates'

function eventFeature(eventname = 'bushy', longitude = -1.25, latitude = 51.5) {
  return {
    id: 1,
    type: 'Feature' as const,
    geometry: {
      type: 'Point' as const,
      coordinates: [longitude, latitude] as [number, number],
    },
    properties: {
      eventname,
      EventLongName: `${eventname} parkrun`,
      EventShortName: eventname,
      LocalisedEventLongName: null,
      countrycode: 97,
      seriesid: 1,
      EventLocation: eventname,
    },
  }
}

function eventsJson(features = [eventFeature()]) {
  return {
    countries: {
      '97': {
        url: 'www.parkrun.org.uk',
        bounds: [-10, 45, 5, 60] as [number, number, number, number],
      },
    },
    events: {
      type: 'FeatureCollection' as const,
      features,
    },
  }
}

function pointPlacemark(name: string, longitude: number, latitude: number) {
  return `
    <Placemark>
      <name>${name}</name>
      <Point>
        <coordinates>${longitude},${latitude},0</coordinates>
      </Point>
    </Placemark>
  `
}

function routePlacemark(coordinates: string) {
  return `
    <Placemark>
      <name>Course</name>
      <LineString>
        <coordinates>${coordinates}</coordinates>
      </LineString>
    </Placemark>
  `
}

function kml(...placemarks: string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?><kml><Document>${placemarks.join('')}</Document></kml>`
}

function courseHtml(mid = 'abc123') {
  return `<iframe src="https://www.google.com/maps/d/embed?t=h&amp;mid=${mid}"></iframe>`
}

type MockedFetchResponse = {
  url: string
  status?: number
  body?: string
  headers?: HeadersInit
}

let mockedFetchResponses: MockedFetchResponse[] = []

function addFetchMock(response: MockedFetchResponse) {
  mockedFetchResponses.push(response)
}

function mockEventsResponse(features = [eventFeature()]) {
  addFetchMock({
    url: 'https://images.parkrun.com/events.json',
    status: 200,
    body: JSON.stringify(eventsJson(features)),
    headers: { etag: '"events-etag"' },
  })
}

function mockRouteResponses(mid = 'mid-1') {
  addFetchMock({
    url: 'https://www.parkrun.org.uk/bushy/course/',
    body: courseHtml(mid),
  })
  addFetchMock({
    url: `https://www.google.com/maps/d/kml?mid=${mid}&forcekml=1`,
    body: kml(pointPlacemark('Finish', -0.9, 51.9)),
  })
}

const completeEnv = {
  SIGNER_CERT: 'test-signer-cert',
  SIGNER_KEY: 'test-signer-key',
  SIGNER_KEY_PASSPHRASE: 'test-passphrase',
  PASS_TYPE_IDENTIFIER: 'pass.com.getrunpass.test',
  TEAM_IDENTIFIER: 'TEAMID1234',
  GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: 'wallet-signer@example.iam.gserviceaccount.com',
  GOOGLE_WALLET_SERVICE_ACCOUNT_PRIVATE_KEY: 'private-key',
  GOOGLE_WALLET_CLASS_ID: 'issuer123.runpass.parkrun',
  GOOGLE_WALLET_ALLOWED_ORIGINS: 'https://getrunpass.com/path,www.getrunpass.com, localhost:8080 ',
  GOOGLE_WALLET_FRONTEND_URL: 'https://getrunpass.com',
  RUNPASS_TEST_PKPASS: 'test-pkpass',
} satisfies Env

beforeEach(() => {
  resetEventsJsonCache()
  mockedFetchResponses = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
    const index = mockedFetchResponses.findIndex(response => response.url === url)

    if (index === -1) {
      throw new Error(`Unexpected fetch: ${url}`)
    }

    const [mock] = mockedFetchResponses.splice(index, 1)
    return new Response(mock.body || null, {
      status: mock.status || 200,
      headers: mock.headers,
    })
  })
})

afterEach(() => {
  expect(mockedFetchResponses).toEqual([])
  vi.unstubAllGlobals()
})

describe('Google Wallet helpers in the Workers runtime', () => {
  it('normalizes origin config host values', () => {
    expect(normalizeGoogleWalletOrigins('https://getrunpass.com/path,www.getrunpass.com, localhost:8080 '))
      .toEqual(['getrunpass.com', 'www.getrunpass.com', 'localhost:8080'])
  })

  it('reports missing required secrets', () => {
    const config = getGoogleWalletConfig({
      GOOGLE_WALLET_FRONTEND_URL: 'https://dev.getrunpass.com',
    })

    expect(config.missing).toEqual([
      'GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL',
      'GOOGLE_WALLET_SERVICE_ACCOUNT_PRIVATE_KEY',
      'GOOGLE_WALLET_CLASS_ID',
    ])
    expect(config.allowedOrigins).toEqual(['dev.getrunpass.com'])
  })

  it('builds Generic object fields and merchant locations', () => {
    const walletObject = buildGoogleWalletObject(
      {
        barcode: 'A1234567',
        name: 'Runner One',
        locations: ['bushy'],
      },
      'issuer123.runpass.parkrun',
      'https://getrunpass.com',
      [
        {
          latitude: 51.412,
          longitude: -0.337,
          source: 'finish',
          relevantText: 'Bushy parkrun',
          eventname: 'bushy',
        },
      ],
    )

    expect(walletObject.id).toMatch(/^issuer123\.runpass-/)
    expect(walletObject.classId).toBe('issuer123.runpass.parkrun')
    expect(walletObject.barcode.type).toBe('CODE_128')
    expect(walletObject.barcode.value).toBe('A1234567')
    expect(walletObject.header.defaultValue).toEqual({
      language: 'en-GB',
      value: 'Runner One',
    })
    expect(walletObject.merchantLocations).toEqual([
      {
        latitude: 51.412,
        longitude: -0.337,
      },
    ])
    expect(walletObject.textModulesData.map(module => module.id)).toEqual([
      'parkrun-id',
      'runner-name',
      'local-runs',
    ])
  })

  it('builds savetowallet claims with expiry, origins, and Generic object payload', () => {
    const config = getGoogleWalletConfig(completeEnv)
    const claims = buildGoogleWalletClaims(
      {
        barcode: 'A7654321',
        locations: [],
      },
      config,
      [],
      1735689600,
    )

    expect(claims.iss).toBe(completeEnv.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL)
    expect(claims.aud).toBe('google')
    expect(claims.typ).toBe('savetowallet')
    expect(claims.iat).toBe(1735689600)
    expect(claims.exp).toBe(1735693200)
    expect(claims.origins).toEqual(['getrunpass.com', 'www.getrunpass.com', 'localhost:8080'])
    expect(claims.payload.genericObjects[0].barcode.value).toBe('A7654321')
  })
})

describe('route location parsing in the Workers runtime', () => {
  it('uses a separate Finish placemark before Start', () => {
    const parsed = parseKmlRouteMetadata(
      kml(
        routePlacemark('-0.1,51.1,0 -0.2,51.2,0'),
        pointPlacemark('Start', -0.3, 51.3),
        pointPlacemark('Finish', -0.4, 51.4),
      ),
    )

    expect(parsed).toEqual({
      coordinate: { longitude: -0.4, latitude: 51.4, altitude: 0 },
      source: 'finish',
    })
  })

  it('falls back to Start and then the last route coordinate', () => {
    expect(parseKmlRouteMetadata(
      kml(routePlacemark('-0.1,51.1,0 -0.2,51.2,0'), pointPlacemark('Start', -0.3, 51.3)),
    )).toEqual({
      coordinate: { longitude: -0.3, latitude: 51.3, altitude: 0 },
      source: 'start',
    })

    expect(parseKmlRouteMetadata(
      kml(routePlacemark('-0.1,51.1,0 -0.2,51.2,0 -0.3,51.3,0')),
    )).toEqual({
      coordinate: { longitude: -0.3, latitude: 51.3, altitude: 0 },
      source: 'route-last-coordinate',
    })
  })

  it('extracts Google map ids from course HTML', () => {
    expect(extractMapFromCourseHtml(courseHtml('mid-2'))).toEqual({
      mapUrl: 'https://www.google.com/maps/d/embed?t=h&mid=mid-2',
      mid: 'mid-2',
    })
  })

  it('falls back to events.json points when route fetches fail', async () => {
    const event = eventFeature()
    const routeFetch = async () => {
      throw new Error('network unavailable')
    }

    const location = await resolveEventPassLocation(event, eventsJson().countries, routeFetch)

    expect(location.source).toBe('events-json-point')
    expect(location.longitude).toBe(-1.25)
    expect(location.latitude).toBe(51.5)
  })

  it('resolves selected pass locations for Apple and Google payloads', async () => {
    const event = eventFeature()
    const routeFetch = async (url: string) => {
      if (url === 'https://www.parkrun.org.uk/bushy/course/') {
        return new Response(courseHtml('mid-3'))
      }
      if (url === 'https://www.google.com/maps/d/kml?mid=mid-3&forcekml=1') {
        return new Response(kml(pointPlacemark('Finish', -0.9, 51.9)))
      }
      return new Response('missing mock response', { status: 404 })
    }

    const locations = await resolvePassLocationsForPass(['missing', 'bushy'], eventsJson([event]), routeFetch)

    expect(locations).toHaveLength(1)
    expect(locations[0].source).toBe('finish')
    expect(toApplePassLocation(locations[0])).toEqual({
      longitude: -0.9,
      latitude: 51.9,
      relevantText: 'bushy parkrun',
    })
    expect(toGoogleMerchantLocation(locations[0])).toEqual({
      longitude: -0.9,
      latitude: 51.9,
    })
  })
})

describe('Worker endpoints in the Workers runtime', () => {
  it('redirects Google Wallet saves to pay.google.com with a signed JWT', async () => {
    mockEventsResponse()

    const response = await SELF.fetch(new Request(
      'https://getrunpass.test/google-wallet?barcode=A1234567',
      { redirect: 'manual' },
    ))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toMatch(
      new RegExp(`^${GOOGLE_WALLET_SAVE_URL_PREFIX.replace(/\//g, '\\/')}`),
    )
  })

  it('accepts selected locations on Google Wallet saves', async () => {
    mockEventsResponse()
    mockRouteResponses('selected-mid')

    const response = await SELF.fetch(new Request(
      'https://getrunpass.test/google-wallet?barcode=A1234567&locations=bushy',
      { redirect: 'manual' },
    ))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain(GOOGLE_WALLET_SAVE_URL_PREFIX)
  })

  it('returns 400 for missing Google Wallet barcode', async () => {
    const response = await SELF.fetch('https://getrunpass.test/google-wallet')

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Missing required query param: barcode')
  })

  it('returns 400 for missing Google Wallet secrets', async () => {
    const ctx = createExecutionContext()
    const response = await worker.fetch(
      new Request('https://getrunpass.test/google-wallet?barcode=A1234567'),
      {
        ...completeEnv,
        GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: undefined,
        GOOGLE_WALLET_SERVICE_ACCOUNT_PRIVATE_KEY: undefined,
        GOOGLE_WALLET_CLASS_ID: undefined,
      },
      ctx,
    )
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(400)
    expect(await response.text()).toContain('Google Wallet is not configured')
  })

  it('returns pkpass content type for Apple Wallet with selected locations', async () => {
    mockEventsResponse()
    mockRouteResponses('apple-mid')

    const response = await SELF.fetch('https://getrunpass.test/passbook?barcode=A1234567&locations=bushy')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/vnd.apple.pkpass')
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe('test-pkpass')
  })

  it('serves events.json and honors If-None-Match', async () => {
    mockEventsResponse()
    addFetchMock({
      url: 'https://images.parkrun.com/events.json',
      status: 304,
    })

    const first = await SELF.fetch('https://getrunpass.test/events.json')
    expect(first.status).toBe(200)
    expect(first.headers.get('etag')).toBe('"events-etag"')
    expect(await first.json()).toEqual(eventsJson())

    const second = await SELF.fetch('https://getrunpass.test/events.json', {
      headers: { 'If-None-Match': '"events-etag"' },
    })
    expect(second.status).toBe(304)
  })
})
