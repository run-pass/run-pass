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

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function readTag(xml: string, tagName: string): string | undefined {
  const match = xml.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'))

  if (!match) {
    return undefined
  }

  return decodeHtml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim())
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

function parsePlacemarks(kml: string): Placemark[] {
  if (!/<kml[\s>]/i.test(kml)) {
    return []
  }

  const placemarks: Placemark[] = []
  const placemarkRegex = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi
  let match: RegExpExecArray | null

  while ((match = placemarkRegex.exec(kml))) {
    const placemarkXml = match[1]
    const type = /<LineString\b/i.test(placemarkXml)
      ? 'LineString'
      : /<Point\b/i.test(placemarkXml)
        ? 'Point'
        : 'Unknown'

    placemarks.push({
      name: readTag(placemarkXml, 'name') || '',
      type,
      coordinates: parseCoordinateList(readTag(placemarkXml, 'coordinates')),
    })
  }

  return placemarks
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
  const routeLastCoordinate = route
    ? route.coordinates[route.coordinates.length - 1]
    : undefined

  if (routeLastCoordinate) {
    return { coordinate: routeLastCoordinate, source: 'route-last-coordinate' }
  }

  return undefined
}

export function extractMapFromCourseHtml(html: string): { mapUrl: string | null; mid: string } | undefined {
  const decoded = decodeHtml(html)
  const urls = new Set<string>()
  const urlRegex = /https?:\/\/(?:www\.)?google\.com\/maps\/d\/(?:u\/\d+\/)?(?:embed|viewer)\?[^"'<>\s)]+/gi
  let match: RegExpExecArray | null

  while ((match = urlRegex.exec(decoded))) {
    urls.add(match[0])
  }

  for (const mapUrl of urls) {
    try {
      const mid = new URL(mapUrl).searchParams.get('mid')

      if (mid) {
        return { mapUrl, mid }
      }
    } catch {}
  }

  const midMatch = decoded.match(/[?&]mid=([^&"'<>\s)]+)/i)

  if (midMatch) {
    return {
      mapUrl: null,
      mid: decodeURIComponent(midMatch[1]),
    }
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
  const countryUrl = country ? country.url : undefined

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

export function toGoogleMerchantLocation(location: ResolvedPassLocation) {
  return {
    latitude: location.latitude,
    longitude: location.longitude,
  }
}
