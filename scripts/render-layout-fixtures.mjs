import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const server = await createServer({
  configFile: false,
  plugins: [react()],
  server: { middlewareMode: true },
  logLevel: 'silent',
})
try {
  const { renderLayoutFixtures } = await server.ssrLoadModule('/tests/e2e/layout-fixtures.ts')
  process.stdout.write(JSON.stringify(renderLayoutFixtures()))
} finally {
  await server.close()
}
