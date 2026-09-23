# todo-app

Todo lists and a calendar at https://todo.matteob.dev: an offline-capable PWA for desktop and phone,
showing Save the Date's dates alongside, with an MCP connector for Claude.

```bash
npm install
cp .dev.vars.example .dev.vars   # or write REGISTRATION_SECRET=... and STD_TOKEN=...
npm run dev                      # http://localhost:8787, sign up at /signup with the invite code
npm test
```

## Connect Claude

In claude.ai, add a custom connector with the URL `https://todo.matteob.dev/mcp`. Claude registers
itself, you log in and approve on the consent page, and it can then use the tools (`get_agenda`,
`create_event`, `update_item`, ...).

See `CLAUDE.md` for the architecture, bindings, secrets and the sync model.
