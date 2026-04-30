import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

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
          RUNPASS_TEST_PKPASS: 'test-pkpass',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
})
