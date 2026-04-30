import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import vm from 'node:vm'

function loadGoogleWalletModule() {
  const source = readFileSync(new URL('../src/googleWallet.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  })
  const module = { exports: {} }
  const context = {
    URL,
    TextEncoder,
    atob(value) {
      return Buffer.from(value, 'base64').toString('binary')
    },
    btoa(value) {
      return Buffer.from(value, 'binary').toString('base64')
    },
    crypto: {
      subtle: {
        async importKey() {
          return {}
        },
        async sign() {
          return new Uint8Array([1, 2, 3]).buffer
        },
      },
    },
    exports: module.exports,
    module,
    require(specifier) {
      if (specifier === 'uuid') {
        return {
          v4() {
            return '00000000-0000-4000-8000-000000000000'
          },
        }
      }

      if (specifier === './locationMapping') {
        return {
          async getEventsJson() {
            throw new Error('unexpected getEventsJson call')
          },
        }
      }

      if (specifier === './routeCoordinates') {
        return {
          async resolvePassLocationsForPass(locationIds, eventsJson) {
            const events = Object.fromEntries(
              eventsJson.events.features.map(event => [event.properties.eventname, event]),
            )

            return locationIds
              .map(locationId => events[locationId])
              .filter(Boolean)
              .slice(0, 10)
              .map(event => ({
                latitude: event.geometry.coordinates[1],
                longitude: event.geometry.coordinates[0],
                source: 'events-json-point',
                relevantText: event.properties.EventLongName,
                eventname: event.properties.eventname,
              }))
          },
          toGoogleMerchantLocation(location) {
            return {
              latitude: location.latitude,
              longitude: location.longitude,
            }
          },
        }
      }

      throw new Error(`Unexpected require: ${specifier}`)
    },
  }

  vm.runInNewContext(outputText, context, { filename: 'googleWallet.ts' })

  return module.exports
}

const {
  GOOGLE_WALLET_SAVE_URL_PREFIX,
  buildGoogleWalletClaims,
  buildGoogleWalletObject,
  buildGoogleWalletSaveLink,
  getGoogleWalletConfig,
  normalizeGoogleWalletOrigins,
} = loadGoogleWalletModule()

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

const completeSecrets = {
  GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: 'wallet-signer@example.iam.gserviceaccount.com',
  GOOGLE_WALLET_SERVICE_ACCOUNT_PRIVATE_KEY: 'private-key',
  GOOGLE_WALLET_CLASS_ID: 'issuer123.runpass.parkrun',
  GOOGLE_WALLET_ALLOWED_ORIGINS: 'https://getrunpass.com/path,www.getrunpass.com, localhost:8080 ',
  GOOGLE_WALLET_FRONTEND_URL: 'https://getrunpass.com',
}

function eventFeature(eventname, longitude, latitude) {
  return {
    id: 1,
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [longitude, latitude],
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

test('Google Wallet origin config normalizes host values', () => {
  assert.deepEqual(
    plain(normalizeGoogleWalletOrigins('https://getrunpass.com/path,www.getrunpass.com, localhost:8080 ')),
    ['getrunpass.com', 'www.getrunpass.com', 'localhost:8080'],
  )
})

test('Google Wallet config reports missing required secrets', () => {
  const config = getGoogleWalletConfig({
    GOOGLE_WALLET_FRONTEND_URL: 'https://dev.getrunpass.com',
  })

  assert.deepEqual(plain(config.missing), [
    'GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_WALLET_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_WALLET_CLASS_ID',
  ])
  assert.deepEqual(plain(config.allowedOrigins), ['dev.getrunpass.com'])
})

test('Google Wallet object includes barcode, text modules, and merchant locations', () => {
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

  assert.equal(walletObject.id, 'issuer123.runpass-00000000-0000-4000-8000-000000000000')
  assert.equal(walletObject.classId, 'issuer123.runpass.parkrun')
  assert.equal(walletObject.barcode.type, 'CODE_128')
  assert.equal(walletObject.barcode.value, 'A1234567')
  assert.deepEqual(plain(walletObject.header.defaultValue), {
    language: 'en-GB',
    value: 'Runner One',
  })
  assert.deepEqual(plain(walletObject.merchantLocations), [
    {
      latitude: 51.412,
      longitude: -0.337,
    },
  ])
  assert.deepEqual(
    plain(walletObject.textModulesData.map(module => module.id)),
    ['parkrun-id', 'runner-name', 'local-runs'],
  )
})

test('Google Wallet claims use savetowallet audience, expiry, origins, and Generic object payload', () => {
  const config = getGoogleWalletConfig(completeSecrets)
  const claims = buildGoogleWalletClaims(
    {
      barcode: 'A7654321',
      locations: [],
    },
    config,
    [],
    1735689600,
  )

  assert.equal(claims.iss, completeSecrets.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL)
  assert.equal(claims.aud, 'google')
  assert.equal(claims.typ, 'savetowallet')
  assert.equal(claims.iat, 1735689600)
  assert.equal(claims.exp, 1735693200)
  assert.deepEqual(plain(claims.origins), ['getrunpass.com', 'www.getrunpass.com', 'localhost:8080'])
  assert.equal(claims.payload.genericObjects.length, 1)
  assert.equal(claims.payload.genericObjects[0].barcode.value, 'A7654321')
})

test('Google Wallet save link signs claims and preserves selected locations', async () => {
  let signedClaims
  let signedPrivateKey
  const saveLink = await buildGoogleWalletSaveLink(
    {
      barcode: 'A9999999',
      name: 'Runner Two',
      locations: ['missing', 'bushy'],
    },
    {
      secrets: completeSecrets,
      nowSeconds: () => 1735689600,
      async eventsJsonLoader() {
        return {
          etag: null,
          data: {
            countries: {},
            events: {
              type: 'FeatureCollection',
              features: [eventFeature('bushy', -0.337, 51.412)],
            },
          },
        }
      },
      async signer(claims, privateKey) {
        signedClaims = claims
        signedPrivateKey = privateKey
        return 'signed.jwt'
      },
    },
  )

  assert.equal(saveLink, `${GOOGLE_WALLET_SAVE_URL_PREFIX}signed.jwt`)
  assert.equal(signedPrivateKey, completeSecrets.GOOGLE_WALLET_SERVICE_ACCOUNT_PRIVATE_KEY)
  assert.equal(signedClaims.payload.genericObjects[0].barcode.value, 'A9999999')
  assert.deepEqual(signedClaims.payload.genericObjects[0].merchantLocations, [
    {
      latitude: 51.412,
      longitude: -0.337,
    },
  ])
})

test('Google Wallet save link fails clearly when required secrets are missing', async () => {
  await assert.rejects(
    () =>
      buildGoogleWalletSaveLink({
        barcode: 'A1234567',
        locations: [],
      }),
    /Google Wallet is not configured\. Missing secrets:/,
  )
})
