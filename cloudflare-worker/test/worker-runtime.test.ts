import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetEventsJsonCache } from '../src/locationMapping'
import {
  extractMapFromCourseHtml,
  parseKmlRouteMetadata,
  resolveEventPassLocation,
  resolvePassLocationsForPass,
  toApplePassLocation,
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

  it('resolves selected pass locations for Apple payloads', async () => {
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
  })
})

describe('Worker endpoints in the Workers runtime', () => {
  it('redirects /github', async () => {
    const response = await SELF.fetch(new Request(
      'https://getrunpass.test/github',
      { redirect: 'manual' },
    ))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://github.com/run-pass/run-pass/')
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

  it('returns 404 for unknown routes', async () => {
    const response = await SELF.fetch('https://getrunpass.test/unknown')

    expect(response.status).toBe(404)
  })
})
