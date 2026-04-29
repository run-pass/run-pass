import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import vm from 'node:vm'

const nodeRequire = createRequire(import.meta.url)

function loadRouteCoordinatesModule() {
  const source = readFileSync(new URL('../src/routeCoordinates.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  })
  const module = { exports: {} }
  const context = {
    AbortController,
    URL,
    clearTimeout,
    exports: module.exports,
    fetch,
    module,
    require(specifier) {
      if (specifier === './locationMapping') {
        return {
          createLocationMapping(eventsJson) {
            return Object.fromEntries(
              eventsJson.events.features.map(event => [event.properties.eventname, event]),
            )
          },
        }
      }

      return nodeRequire(specifier)
    },
    setTimeout,
  }

  vm.runInNewContext(outputText, context, { filename: 'routeCoordinates.ts' })

  return module.exports
}

const {
  parseKmlRouteMetadata,
  resolveEventPassLocation,
  resolvePassLocationsForPass,
  toApplePassLocation,
} = loadRouteCoordinatesModule()

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function eventFeature(overrides = {}) {
  return {
    id: 1,
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [-1.25, 51.5],
    },
    properties: {
      eventname: 'bushy',
      EventLongName: 'Bushy parkrun',
      EventShortName: 'Bushy Park',
      LocalisedEventLongName: null,
      countrycode: 97,
      seriesid: 1,
      EventLocation: 'Bushy Park',
    },
    ...overrides,
  }
}

function eventsJson(features = [eventFeature()]) {
  return {
    countries: {
      '97': {
        url: 'www.parkrun.org.uk',
        bounds: [-10, 45, 5, 60],
      },
    },
    events: {
      type: 'FeatureCollection',
      features,
    },
  }
}

function pointPlacemark(name, longitude, latitude) {
  return `
    <Placemark>
      <name>${name}</name>
      <Point>
        <coordinates>${longitude},${latitude},0</coordinates>
      </Point>
    </Placemark>
  `
}

function routePlacemark(coordinates) {
  return `
    <Placemark>
      <name>Course</name>
      <LineString>
        <coordinates>${coordinates}</coordinates>
      </LineString>
    </Placemark>
  `
}

function kml(...placemarks) {
  return `<?xml version="1.0" encoding="UTF-8"?><kml><Document>${placemarks.join('')}</Document></kml>`
}

function courseHtml(mid = 'abc123') {
  return `<iframe src="https://www.google.com/maps/d/embed?t=h&amp;mid=${mid}"></iframe>`
}

function mockFetchByUrl(responsesByUrl) {
  const calls = []
  const routeFetch = async url => {
    calls.push(url)
    const response = responsesByUrl[url]

    if (response instanceof Error) {
      throw response
    }

    if (!response) {
      return new Response('missing mock response', { status: 404 })
    }

    return new Response(response.body, { status: response.status || 200 })
  }

  return { calls, routeFetch }
}

test('KML parser uses a separate Finish placemark before Start', () => {
  const parsed = parseKmlRouteMetadata(
    kml(
      routePlacemark('-0.1,51.1,0 -0.2,51.2,0'),
      pointPlacemark('Start', -0.3, 51.3),
      pointPlacemark('Finish', -0.4, 51.4),
    ),
  )

  assert.deepEqual(plain(parsed), {
    coordinate: { longitude: -0.4, latitude: 51.4, altitude: 0 },
    source: 'finish',
  })
})

test('KML parser falls back to Start when Finish is unavailable', () => {
  const parsed = parseKmlRouteMetadata(
    kml(routePlacemark('-0.1,51.1,0 -0.2,51.2,0'), pointPlacemark('Start', -0.3, 51.3)),
  )

  assert.deepEqual(plain(parsed), {
    coordinate: { longitude: -0.3, latitude: 51.3, altitude: 0 },
    source: 'start',
  })
})

test('KML parser falls back to the last route coordinate when markers are unavailable', () => {
  const parsed = parseKmlRouteMetadata(
    kml(routePlacemark('-0.1,51.1,0 -0.2,51.2,0 -0.3,51.3,0')),
  )

  assert.deepEqual(plain(parsed), {
    coordinate: { longitude: -0.3, latitude: 51.3, altitude: 0 },
    source: 'route-last-coordinate',
  })
})

test('course page fetch failure falls back to the events.json point', async () => {
  const event = eventFeature()
  const { calls, routeFetch } = mockFetchByUrl({
    'https://www.parkrun.org.uk/bushy/course/': new Error('network unavailable'),
  })

  const location = await resolveEventPassLocation(event, eventsJson().countries, routeFetch)

  assert.equal(calls.length, 1)
  assert.equal(location.source, 'events-json-point')
  assert.equal(location.longitude, -1.25)
  assert.equal(location.latitude, 51.5)
})

test('Google KML fetch failure falls back to the events.json point', async () => {
  const event = eventFeature()
  const { calls, routeFetch } = mockFetchByUrl({
    'https://www.parkrun.org.uk/bushy/course/': { body: courseHtml('mid-1') },
    'https://www.google.com/maps/d/kml?mid=mid-1&forcekml=1': new Error('google unavailable'),
  })

  const location = await resolveEventPassLocation(event, eventsJson().countries, routeFetch)

  assert.equal(calls.length, 2)
  assert.equal(location.source, 'events-json-point')
  assert.equal(location.longitude, -1.25)
  assert.equal(location.latitude, 51.5)
})

test('malformed KML falls back to the events.json point', async () => {
  const event = eventFeature()
  const { routeFetch } = mockFetchByUrl({
    'https://www.parkrun.org.uk/bushy/course/': { body: courseHtml('mid-2') },
    'https://www.google.com/maps/d/kml?mid=mid-2&forcekml=1': { body: 'not kml' },
  })

  const location = await resolveEventPassLocation(event, eventsJson().countries, routeFetch)

  assert.equal(location.source, 'events-json-point')
  assert.equal(location.longitude, -1.25)
  assert.equal(location.latitude, 51.5)
})

test('pass location resolver ignores invalid slugs and produces Apple pass coordinates', async () => {
  const event = eventFeature()
  const { routeFetch } = mockFetchByUrl({
    'https://www.parkrun.org.uk/bushy/course/': { body: courseHtml('mid-3') },
    'https://www.google.com/maps/d/kml?mid=mid-3&forcekml=1': {
      body: kml(pointPlacemark('Finish', -0.9, 51.9)),
    },
  })

  const locations = await resolvePassLocationsForPass(['missing', 'bushy'], eventsJson([event]), routeFetch)

  assert.equal(locations.length, 1)
  assert.equal(locations[0].source, 'finish')
  assert.deepEqual(plain(toApplePassLocation(locations[0])), {
    longitude: -0.9,
    latitude: 51.9,
    relevantText: 'Bushy parkrun',
  })
})
