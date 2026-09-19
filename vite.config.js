import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// En producción (Vercel/Netlify) una regla de hosting reescribe /inmuebles/:numero
// hacia reservar.html. Este plugin hace lo mismo en el servidor de desarrollo local,
// para que el link que le llega al cliente (citas.patrimonios.co/inmuebles/245) se
// vea igual mientras se prueba en localhost.
function reescrituraInmuebles() {
  return {
    name: 'reescritura-inmuebles',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && /^\/inmuebles\/\d+/.test(req.url)) {
          req.url = '/reservar.html';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: 'aplicacion',
  envDir: '..',
  plugins: [reescrituraInmuebles()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'aplicacion/index.html'),
        reservar: resolve(__dirname, 'aplicacion/reservar.html'),
      },
    },
  },
});
