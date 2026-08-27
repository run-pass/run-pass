// Base URL for the Worker API.
//
// Replaced at build time by webpack's DefinePlugin (see webpack.config.js) from
// the API_BASE_URL environment variable, so a PR preview can be pointed at its
// own preview Worker instead of production. Falls back to production when the
// variable is unset, which keeps local builds working unchanged.
export const API_BASE: string =
  process.env.API_BASE_URL || 'https://prod-api.getrunpass.com'
