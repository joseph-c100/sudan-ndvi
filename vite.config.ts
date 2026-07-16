import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
	// served from https://joseph-c100.github.io/sudan-ndvi/ on github pages, so
	// the app runs under a base path in production; empty in dev.
	const base = mode === 'production' ? '/sudan-ndvi' : '';

	return {
		plugins: [
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},

				// static prerendered output for github pages
				adapter: adapter({ fallback: '404.html' }),
				paths: { base }
			})
		]
	};
});
