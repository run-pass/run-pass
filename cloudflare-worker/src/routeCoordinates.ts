import { XMLParser } from 'fast-xml-parser'
import { DomUtils, parseDocument } from 'htmlparser2'
import type { Country, EventFeature, EventsJson } from './locationMapping'
import { createLocationMapping } from './locationMapping'

const ROUTE_FETCH_CACHE_TTL_SECONDS = 60 * 60 * 24
const ROUTE_FETCH_TIMEOUT_MS = 5000
const USER_AGENT =
  'Mozilla/5.0 (compatible; run-pass-route-resolver/1.0; +https://github.com/run-pass/run-pass)'

export type CoordinateSource =
  | 'finish'
  | 'start'
  | 'route-last-coordinate'
  | 'events-json-point'

export type Coordinate = {
  latitude: number
  longitude: number
  altitude?: number
}

export type ResolvedPassLocation = Coordinate & {
  source: CoordinateSource
  relevantText: string
  eventname: string
}

type RouteFetch = (
  input: string,
  init?: RequestInit & { cf?: unknown },
) => Promise<Response>

type Placemark = {
  name: string
  type: 'Point' | 'LineString' | 'Unknown'
  coordinates: Coordinate[]
}

function parseCoordinateList(raw: string | undefined): Coordinate[] {
  if (!raw) {
    return []
  }

  return raw
    .trim()
    .split(/\s+/)
    .map(token => {
      const [longitude, latitude, altitude] = token.split(',').map(Number)

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return undefined
      }

      return {
        latitude,
        longitude,
        ...(Number.isFinite(altitude) ? { altitude } : {}),
      }
    })
    .filter((coordinate): coordinate is Coordinate => Boolean(coordinate))
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return stringValue(value[0])
  }

  if (value && typeof value === 'object') {
    const text = (value as Record<string, unknown>)['#text']
    return stringValue(text)
  }

  return undefined
}

function collectPlacemarks(value: unknown, placemarks: Record<string, unknown>[]) {
  if (Array.isArray(value)) {
    value.forEach(item => collectPlacemarks(item, placemarks))
    return
  }

  if (!value || typeof value !== 'object') {
    return
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'Placemark') {
      placemarks.push(...asArray(child as Record<string, unknown> | Record<string, unknown>[]))
    } else {
      collectPlacemarks(child, placemarks)
    }
  }
}

function parsePlacemarks(kml: string): Placemark[] {
  let parsed: unknown

  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      parseTagValue: false,
      removeNSPrefix: true,
      trimValues: true,
    }).parse(kml)
  } catch {
    return []
  }

  const placemarkObjects: Record<string, unknown>[] = []
  collectPlacemarks(parsed, placemarkObjects)

  return placemarkObjects.map(placemark => {
    const type = placemark.LineString
      ? 'LineString'
      : placemark.Point
        ? 'Point'
        : 'Unknown'
    const geometry = type === 'LineString'
      ? placemark.LineString as Record<string, unknown>
      : placemark.Point as Record<string, unknown>

    return {
      name: stringValue(placemark.name) || '',
      type,
      coordinates: parseCoordinateList(stringValue(geometry && geometry.coordinates)),
    }
  })
}

export function parseKmlRouteMetadata(
  kml: string,
): { coordinate: Coordinate; source: Exclude<CoordinateSource, 'events-json-point'> } | undefined {
  const placemarks = parsePlacemarks(kml)
  const finish = placemarks.find(
    placemark => placemark.type === 'Point' && /\bfinish\b/i.test(placemark.name) && placemark.coordinates[0],
  )

  if (finish && finish.coordinates[0]) {
    return { coordinate: finish.coordinates[0], source: 'finish' }
  }

  const start = placemarks.find(
    placemark => placemark.type === 'Point' && /\bstart\b/i.test(placemark.name) && placemark.coordinates[0],
  )

  if (start && start.coordinates[0]) {
    return { coordinate: start.coordinates[0], source: 'start' }
  }

  const route = placemarks.find(
    placemark => placemark.type === 'LineString' && placemark.coordinates.length > 0,
  )
  const routeLastCoordinate = route && route.coordinates[route.coordinates.length - 1]

  if (routeLastCoordinate) {
    return { coordinate: routeLastCoordinate, source: 'route-last-coordinate' }
  }

  return undefined
}

export function extractMapFromCourseHtml(html: string): { mapUrl: string | null; mid: string } | undefined {
  const document = parseDocument(html, { decodeEntities: true })
  const elements = DomUtils.findAll(
    node => Boolean(node.attribs),
    document.children,
  )
  const attributeValues = elements.flatMap(element => Object.values(element.attribs || {}))

  for (const mapUrl of attributeValues) {
    try {
      const parsedUrl = new URL(mapUrl)
      const isGoogleMapsHost = parsedUrl.hostname === 'www.google.com' || parsedUrl.hostname === 'google.com'
      const isMyMapsPath = parsedUrl.pathname.startsWith('/maps/d/') &&
        (parsedUrl.pathname.endsWith('/embed') || parsedUrl.pathname.endsWith('/viewer'))
      const mid = parsedUrl.searchParams.get('mid')

      if (isGoogleMapsHost && isMyMapsPath && mid) {
        return { mapUrl, mid }
      }
    } catch {}
  }

  return undefined
}

function eventPoint(event: EventFeature): Coordinate {
  return {
    longitude: event.geometry.coordinates[0],
    latitude: event.geometry.coordinates[1],
  }
}

function coursePageUrlForEvent(event: EventFeature, countries: Record<string, Country>): string | undefined {
  const country = countries[String(event.properties.countrycode)]
  const countryUrl = country && country.url

  return countryUrl
    ? `https://${countryUrl}/${event.properties.eventname}/course/`
    : undefined
}

function kmlUrlForMid(mid: string): string {
  return `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(mid)}&forcekml=1`
}

async function fetchText(url: string, routeFetch: RouteFetch): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ROUTE_FETCH_TIMEOUT_MS)

  try {
    const response = await routeFetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'User-Agent': USER_AGENT,
      },
      redirect: 'follow',
      signal: controller.signal,
      cf: {
        cacheEverything: true,
        cacheTtlByStatus: {
          '200-299': ROUTE_FETCH_CACHE_TTL_SECONDS,
          '300-399': ROUTE_FETCH_CACHE_TTL_SECONDS,
          '404': 300,
          '500-599': 0,
        },
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return response.text()
  } finally {
    clearTimeout(timeout)
  }
}

export async function resolveEventPassLocation(
  event: EventFeature,
  countries: Record<string, Country>,
  routeFetch: RouteFetch = fetch,
): Promise<ResolvedPassLocation> {
  const fallback = eventPoint(event)
  const fallbackLocation = {
    ...fallback,
    source: 'events-json-point' as const,
    relevantText: event.properties.EventLongName,
    eventname: event.properties.eventname,
  }
  const coursePageUrl = coursePageUrlForEvent(event, countries)

  if (!coursePageUrl) {
    return fallbackLocation
  }

  try {
    const courseHtml = await fetchText(coursePageUrl, routeFetch)
    const map = extractMapFromCourseHtml(courseHtml)

    if (!map) {
      return fallbackLocation
    }

    const kml = await fetchText(kmlUrlForMid(map.mid), routeFetch)
    const parsed = parseKmlRouteMetadata(kml)

    if (!parsed) {
      return fallbackLocation
    }

    return {
      ...parsed.coordinate,
      source: parsed.source,
      relevantText: event.properties.EventLongName,
      eventname: event.properties.eventname,
    }
  } catch {
    return fallbackLocation
  }
}

export async function resolvePassLocationsForPass(
  locationIds: string[],
  eventsJson: EventsJson,
  routeFetch: RouteFetch = fetch,
): Promise<ResolvedPassLocation[]> {
  const locationMapping = createLocationMapping(eventsJson)
  const events = locationIds
    .map(locId => locationMapping[locId])
    .filter((event): event is EventFeature => Boolean(event))
    .slice(0, 10)

  return Promise.all(
    events.map(event => resolveEventPassLocation(event, eventsJson.countries, routeFetch)),
  )
}

export function toApplePassLocation(location: ResolvedPassLocation) {
  return {
    longitude: location.longitude,
    latitude: location.latitude,
    relevantText: location.relevantText,
  }
}
