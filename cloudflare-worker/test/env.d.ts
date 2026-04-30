import type { Env } from '../src/bindings'

declare global {
  namespace Cloudflare {
    interface Env extends import('../src/bindings').Env {}
  }
}

declare module 'cloudflare:workers' {
  interface ProvidedEnv extends Env {}
}
