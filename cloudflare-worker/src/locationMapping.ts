// --- Types for parkrun events.json ---
export interface Country {
  url: string | null;
  bounds: [number, number, number, number];
}

export interface EventProperties {
  eventname: string;
  EventLongName: string;
  EventShortName: string;
  LocalisedEventLongName: string | null;
  countrycode: number;
  seriesid: number;
  EventLocation: string;
  [key: string]: any;
}

export interface EventFeature {
  id: number;
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: EventProperties;
}

export interface EventsJson {
  countries: Record<string, Country>;
  events: {
    type: 'FeatureCollection';
    features: EventFeature[];
  };
}

export type LocationMapping = Record<string, EventFeature>;
// cloudflare-worker/src/locationMapping.ts
// Shared helper to fetch and cache events.json and build location mapping



let cachedEventsJson: EventsJson | null = null;
let cachedEtag: string | null = null;
const EVENTS_URL = 'https://images.parkrun.com/events.json';

export const getEventsJson = async (): Promise<{ data: EventsJson, etag: string | null }> => {
  const headers: Record<string, string> = {
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-GB,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Priority': 'u=3, i',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15',
  };
  if (cachedEtag) {
    headers['If-None-Match'] = cachedEtag;
  }
  const response = await fetch(EVENTS_URL, {
    headers,
    method: 'GET',
  });
  if (response.status === 304 && cachedEventsJson) {
    // Not modified, return cached
    return { data: cachedEventsJson, etag: cachedEtag };
  }
  const etag = response.headers.get('etag');
  const data = await response.json() as EventsJson;
  cachedEventsJson = data;
  cachedEtag = etag;
  return { data, etag };
};

export const getLocationMapping = async (): Promise<LocationMapping> => {
  const { data } = await getEventsJson();
  const mapping: LocationMapping = {};
  const features = (data.events && data.events.features) ? data.events.features : [];
  for (let i = 0; i < features.length; i++) {
    const d = features[i];
    mapping[d.properties.eventname] = d;
  }
  return mapping;
};
