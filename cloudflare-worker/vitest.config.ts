import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Throwaway RSA key generated solely for these tests. It signs nothing real and
// grants no access; the production key lives in the Worker secret
// GOOGLE_WALLET_SERVICE_ACCOUNT_PRIVATE_KEY.
const googleWalletPrivateKey = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQC0+Ule+2xsEnWk
2VGnV8UgSVUsCr4tQY84BjA9R0ns1/1y3kADscHHEkGBXr2DYPEcnHPI6XTt6h+v
3lF8rlRTCNMkvpQA2shMakPLjh11shI/j2i4g4OmSpZ7MleGThZpth+7EVm/lbNo
w1gzvb3w5sIQh8kmM9B5c5i4/kzQ5G35vul1mR2MK9i47BtyfhpfMb3iMEhKenCv
8wJ1nhBXHPz7b7X4N5Z4Ty+fh7s/Ne879owKdnwJjdVRX1G3X0MxBZyI9qNXEYQ4
a5w4lJYCi8efV5fWkqXsJC/uJAq9gHECaD/hII9vUBOwKCOA1jFMkDoHwU7uFTgx
un/TxTP1AgMBAAECggEAGHh4zlTAQAttnZZxGb1Jf2h1vC3RB1I3vm3qdJlrdTtu
HuvPIMYWxgdBlO+tlSffkmx+pNUZ0C3PORBJA8tCxbOKHAwqURnu6ZOY39uzP2iO
WnUsG37/pysAwV8jl0UpzK4pXjnQtpIpyemtcdmfPFrHikVXZ/NWUNsrnyAWXPcR
bBekulfbPiAfwSx5asWHt6Pmm8az2XDas1nEc/N0L6F+PpYNpThh+gxL1RzNhUI+
Dnn1OVZfT56eUst/AvFqRrE/IBG3LVIbXe7EPXC9xl155riwg/KJAM5dwQdoQ+on
bzGon2/pCFtr1WYZZsmtWFxy/q8M8YqlcWTxp6dcpQKBgQDeKb7d3oSLR57U0Gyq
4A+GgucPrqSRzWtA4281BcIQZidBk6603BxnCCDavxj8Q3uNQqwDz97AdW6LoKgF
L4nqPM8AEEMZ7jLafejBeiH7A4dT3zTUODi4+jtQ9p2EGn8Zf7eKZUmR63AEQWUJ
3I3XuucAW3jBSjATSSe00jKDxwKBgQDQiYyGhUceb2avCO7V+5F4aVsDuHZWKRu9
TtYj6vwXRWQSArjrIxO+4sr80BUnexNF5v6kIuCXCPCJz44Ky/Co9lh5SSy8bPa3
hFABejaxtYSTD1cuJA4nDJAjZuLJhgSbFIks70+WCd25dMXZr5hRpwZynjG0IaYZ
sF/IvsXSYwKBgQDWcptwFWQCAd9ac9oBU4kJAYDCzYTDzPLzztZA6075f3HzRfgF
UtcDyX/VR1N55jX0FGBwyY2uX2yW0Tx+zPWmqo3x9MCg3iIucA1l/VuhrjVKC5I2
LBLs03bAX12K7/yyA2uK5tyOQyJ8qRc73q74h8yFtsYoZlFjvGDclW33bwKBgQCS
lLy0KaaN3Bw/WHYY7xWXn+abvONhONAIxwt6f8fmy53FkyhMD4HnoR6xicn00GwB
rJa85M8dGumI1N2w9R0aht41kpvhbm4VHOnnv/IGA+NGQ3gyNKHGDOycFcu/f3Zp
U4wAi85TVmgF3fDcTLMyYccEdfHV/fj1AaayQnZmpQKBgQCpp28EVuCKw8ZFxyl7
Dsggb5+oVAb19QfVa+IarISB3TQgdREh+JafaJQxVu5aynX4rUxZAWcjf2ypUtxT
HzN3WVWnUh1ZV0Q3MFLeliFlrtkv+KYcQp5TEZxDtyFzrFnuej4D7DKOE52PtatW
fNmIxx4AwVgPLvCOx4QE+RP2/Q==
-----END PRIVATE KEY-----`

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: './wrangler.toml',
      },
      miniflare: {
        bindings: {
          SIGNER_CERT: 'test-signer-cert',
          SIGNER_KEY: 'test-signer-key',
          SIGNER_KEY_PASSPHRASE: 'test-passphrase',
          PASS_TYPE_IDENTIFIER: 'pass.com.getrunpass.test',
          TEAM_IDENTIFIER: 'TEAMID1234',
          GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: 'wallet-signer@example.iam.gserviceaccount.com',
          GOOGLE_WALLET_SERVICE_ACCOUNT_PRIVATE_KEY: googleWalletPrivateKey,
          GOOGLE_WALLET_CLASS_ID: 'issuer123.runpass.parkrun',
          GOOGLE_WALLET_ALLOWED_ORIGINS: 'https://getrunpass.com/path,www.getrunpass.com, localhost:8080',
          GOOGLE_WALLET_FRONTEND_URL: 'https://getrunpass.com',
          RUNPASS_TEST_PKPASS: 'test-pkpass',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
})
