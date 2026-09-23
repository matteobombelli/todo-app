// Extends the generated Env with bindings that only exist under test, and types `exports` from
// cloudflare:workers as the Worker's main module.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
  interface GlobalProps {
    mainModule: typeof import("../worker/index");
  }
}
