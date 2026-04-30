#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'

const DEFAULT_EVENTS_URL = 'https://images.parkrun.com/events.json'
const DEFAULT_OUTPUT = 'parkrun-course-routes.json'
const USER_AGENT =
  'Mozilla/5.0 (compatible; run-pass-route-scraper/1.0; +https://github.com/run-pass/run-pass)'

function parseArgs(argv) {
  const args = {
    concurrency: 4,
    eventsUrl: DEFAULT_EVENTS_URL,
    output: DEFAULT_OUTPUT,
    timeoutMs: 15000,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]

    if (arg === '--event') {
      args.event = requireValue(arg, next)
      i += 1
    } else if (arg === '--country') {
      args.country = Number(requireValue(arg, next))
      i += 1
    } else if (arg === '--limit') {
      args.limit = Number(requireValue(arg, next))
      i += 1
    } else if (arg === '--concurrency') {
      args.concurrency = Number(requireValue(arg, next))
      i += 1
    } else if (arg === '--events-url') {
      args.eventsUrl = requireValue(arg, next)
      i += 1
    } else if (arg === '--output') {
      args.output = requireValue(arg, next)
      i += 1
    } else if (arg === '--map-url') {
      args.mapUrl = requireValue(arg, next)
      i += 1
    } else if (arg === '--mid') {
      args.mid = requireValue(arg, next)
      i += 1
    } else if (arg === '--timeout-ms') {
      args.timeoutMs = Number(requireValue(arg, next))
      i += 1
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) {
    throw new Error('--concurrency must be a positive number')
  }

  if (args.limit !== undefined && (!Number.isFinite(args.limit) || args.limit < 1)) {
    throw new Error('--limit must be a positive number')
  }

  return args
}

function requireValue(flag, value) {
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }

  return value
}

function printHelp() {
  console.log(`Usage:
  node scripts/scrape-parkrun-course-routes.mjs [options]

Options:
  --event <slug>        Scrape one parkrun event, e.g. bushy
  --country <code>      Scrape events for one parkrun country code
  --limit <count>       Stop after this many candidate events
  --concurrency <count> Number of course pages to fetch at once (default: 4)
  --events-url <url>    Source events JSON (default: ${DEFAULT_EVENTS_URL})
  --output <path>       Output JSON path (default: ${DEFAULT_OUTPUT})
  --map-url <url>       Parse one Google My Maps URL instead of discovering it
  --mid <mid>           Parse one Google My Maps mid instead of discovering it
  --timeout-ms <ms>     Per-request timeout (default: 15000)
`)
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

async function fetchText(url, { timeoutMs }) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'User-Agent': USER_AGENT,
      },
      redirect: 'follow',
      signal: controller.signal,
    })

    const body = await response.text()

    if (!response.ok) {
      const err = new Error(`HTTP ${response.status}`)
      err.status = response.status
      err.body = body.slice(0, 300)
      throw err
    }

    return body
  } finally {
    clearTimeout(timeout)
  }
}

function getEventList(eventsJson, args) {
  const features = eventsJson?.events?.features || []
  const countries = eventsJson?.countries || {}

  let events = features
    .filter(event => event?.properties?.eventname)
    .map(event => {
      const countrycode = event.properties.countrycode
      const countryUrl = countries[String(countrycode)]?.url

      return {
        id: event.id,
        eventname: event.properties.eventname,
        eventLongName: event.properties.EventLongName,
        eventShortName: event.properties.EventShortName,
        countrycode,
        countryUrl,
      }
    })
    .filter(event => event.countryUrl)

  if (args.event) {
    events = events.filter(event => event.eventname === args.event)
  }

  if (args.country !== undefined) {
    events = events.filter(event => event.countrycode === args.country)
  }

  if (args.limit !== undefined) {
    events = events.slice(0, args.limit)
  }

  return events
}

function makeCoursePageUrl(event) {
  return `https://${event.countryUrl}/${event.eventname}/course/`
}

function extractMapFromCourseHtml(html) {
  const decoded = decodeHtml(html)
  const urls = new Set()
  const urlRegex = /https?:\/\/(?:www\.)?google\.com\/maps\/d\/(?:u\/\d+\/)?(?:embed|viewer)\?[^"'<>\s)]+/gi
  let match

  while ((match = urlRegex.exec(decoded))) {
    urls.add(match[0])
  }

  const mids = [...urls]
    .map(mapUrl => {
      try {
        return {
          mapUrl,
          mid: new URL(mapUrl).searchParams.get('mid'),
        }
      } catch {
        return undefined
      }
    })
    .filter(item => item?.mid)

  if (mids.length > 0) {
    return mids[0]
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

function extractMidFromMapUrl(mapUrl) {
  const decoded = decodeHtml(mapUrl)

  try {
    const parsed = new URL(decoded)
    const mid = parsed.searchParams.get('mid')

    if (mid) {
      return mid
    }
  } catch {}

  const midMatch = decoded.match(/[?&]mid=([^&"'<>\s)]+)/i)
  return midMatch ? decodeURIComponent(midMatch[1]) : undefined
}

function kmlUrlForMid(mid) {
  return `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(mid)}&forcekml=1`
}

function readTag(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'))

  if (!match) {
    return undefined
  }

  return decodeHtml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim())
}

function parseCoordinateList(raw) {
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
    .filter(Boolean)
}

function parseKml(kml) {
  const placemarks = []
  const placemarkRegex = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi
  let match

  while ((match = placemarkRegex.exec(kml))) {
    const placemarkXml = match[1]
    const name = readTag(placemarkXml, 'name') || ''
    const coordinates = parseCoordinateList(readTag(placemarkXml, 'coordinates'))
    const type = /<LineString\b/i.test(placemarkXml)
      ? 'LineString'
      : /<Point\b/i.test(placemarkXml)
        ? 'Point'
        : 'Unknown'

    placemarks.push({
      name,
      type,
      coordinates,
    })
  }

  const routePlacemark =
    placemarks.find(placemark => placemark.type === 'LineString' && /^course$/i.test(placemark.name)) ||
    placemarks.find(placemark => placemark.type === 'LineString')

  const startPlacemark = placemarks.find(
    placemark => placemark.type === 'Point' && /\bstart\b/i.test(placemark.name),
  )
  const finishPlacemark = placemarks.find(
    placemark => placemark.type === 'Point' && /\bfinish\b/i.test(placemark.name),
  )

  const routeCoordinates = routePlacemark?.coordinates || []
  const start =
    startPlacemark?.coordinates[0] ||
    routeCoordinates[0] ||
    undefined
  const finish =
    finishPlacemark?.coordinates[0] ||
    routeCoordinates[routeCoordinates.length - 1] ||
    undefined

  return {
    route: routePlacemark
      ? {
          name: routePlacemark.name,
          pointCount: routeCoordinates.length,
          coordinates: routeCoordinates,
        }
      : undefined,
    start: start
      ? {
          ...start,
          source: startPlacemark ? startPlacemark.name : 'route-first-coordinate',
        }
      : undefined,
    finish: finish
      ? {
          ...finish,
          source: finishPlacemark ? finishPlacemark.name : 'route-last-coordinate',
        }
      : undefined,
    placemarks: placemarks.map(placemark => ({
      name: placemark.name,
      type: placemark.type,
      pointCount: placemark.coordinates.length,
    })),
  }
}

async function scrapeMap(mid, mapUrl, args) {
  const kmlUrl = kmlUrlForMid(mid)
  const kml = await fetchText(kmlUrl, args)
  const parsed = parseKml(kml)

  if (!parsed.start && !parsed.finish && !parsed.route) {
    throw new Error('KML did not contain route, start, or finish coordinates')
  }

  return {
    mapUrl,
    mid,
    kmlUrl,
    ...parsed,
  }
}

async function scrapeEvent(event, args) {
  const coursePageUrl = makeCoursePageUrl(event)
  const html = await fetchText(coursePageUrl, args)
  const map = extractMapFromCourseHtml(html)

  if (!map) {
    throw new Error('No Google My Maps embed URL found on course page')
  }

  return {
    ...event,
    coursePageUrl,
    ...(await scrapeMap(map.mid, map.mapUrl, args)),
  }
}

async function runPool(items, concurrency, worker) {
  const results = []
  let nextIndex = 0

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1

      results[index] = await worker(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runWorker),
  )

  return results
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const routes = []
  const failures = []

  if (args.mid || args.mapUrl) {
    const mid = args.mid || extractMidFromMapUrl(args.mapUrl)

    if (!mid) {
      throw new Error('Could not determine mid from --map-url')
    }

    routes.push(await scrapeMap(mid, args.mapUrl || null, args))
  } else {
    const eventsJson = JSON.parse(await fetchText(args.eventsUrl, args))
    const events = getEventList(eventsJson, args)

    await runPool(events, args.concurrency, async (event, index) => {
      try {
        const route = await scrapeEvent(event, args)
        routes.push(route)
        console.error(`[${index + 1}/${events.length}] ok ${event.eventname}`)
      } catch (error) {
        failures.push({
          ...event,
          coursePageUrl: makeCoursePageUrl(event),
          reason: error.message,
          ...(error.status ? { status: error.status } : {}),
        })
        console.error(`[${index + 1}/${events.length}] failed ${event.eventname}: ${error.message}`)
      }
    })
  }

  const output = {
    generatedAt: new Date().toISOString(),
    sources: {
      eventsUrl: args.eventsUrl,
    },
    totals: {
      routes: routes.length,
      failures: failures.length,
    },
    routes: routes.sort((a, b) => (a.eventname || '').localeCompare(b.eventname || '')),
    failures: failures.sort((a, b) => (a.eventname || '').localeCompare(b.eventname || '')),
  }

  await writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`)
  console.error(`Wrote ${routes.length} route(s), ${failures.length} failure(s) to ${args.output}`)
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exit(1)
})
