import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS on the LAN: iOS Safari only exposes device orientation in a secure context.
export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true },
});
