import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    // GitHub Pages serves the app from /<repo-name>/
    base: '/Meal-Tracker-App/',
    plugins: [react(), tailwindcss()],
    server: {
        port: 3001,
    },
});
