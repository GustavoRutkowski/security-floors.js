import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, projectRoot, 'VITE_');

    return {
        root: fileURLToPath(new URL('./web/', import.meta.url)),
        envDir: projectRoot,
        server: {
            host: env.VITE_HOST || '0.0.0.0',
            port: Number(env.VITE_PORT || 5173)
        },
        preview: {
            host: env.VITE_PREVIEW_HOST || env.VITE_HOST || '0.0.0.0',
            port: Number(env.VITE_PREVIEW_PORT || 4173)
        },
        build: {
            outDir: fileURLToPath(new URL('./dist/', import.meta.url)),
            emptyOutDir: true
        }
    };
});
