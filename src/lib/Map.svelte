<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import type { Map as MapLibreMap, LngLatBoundsLike } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { towns, countryLabel } from './towns';

	// a switchable ndvi raster layer: a label for the toggle plus a tile template
	interface NdviLayer {
		id: string;
		label: string;
		// raster tile template, e.g. https://.../{z}/{x}/{y}
		tileUrl: string;
	}

	interface Props {
		// ndvi layers the user can toggle between; the first is shown initially
		layers?: NdviLayer[];
		// basemap style json url
		style?: string;
		center?: [number, number];
		zoom?: number;
		tileSize?: number;
		opacity?: number;
		// cap tile fetching at this zoom; past it maplibre upscales existing
		// tiles ("overzoom") instead of requesting new ones — instant zoom-in.
		maxzoom?: number;
		// restrict panning/zoom to this box, [[west, south], [east, north]]
		bounds?: LngLatBoundsLike;
		// show the overview minimap in the corner
		minimap?: boolean;
		// warm the browser tile cache across these zoom levels before revealing
		// the map, so panning/zooming is instant. set preload={false} to skip.
		preload?: boolean;
		// single zoom level whose tiles are cached behind the splash
		preloadZoom?: number;
	}

	let {
		layers = [
			{
				id: 'change',
				label: 'Change',
				tileUrl:
					'https://earthengine.googleapis.com/v1/projects/editorial-democraticprimaries/maps/114ad9167fc11028b984aed044ece5aa-a2dbbb6517f4db1deba5010a4b32a931/tiles/{z}/{x}/{y}'
			},
			{
				id: 'before',
				label: 'Jun 2022 – Mar 2023',
				tileUrl:
					'https://earthengine.googleapis.com/v1/projects/editorial-democraticprimaries/maps/279907af420ce7aa6116c2638b82f33f-48cb9a13544dbc5899343a96eb0ace72/tiles/{z}/{x}/{y}'
			},
			{
				id: 'after',
				label: 'Oct 2023 – Jun 2026',
				tileUrl:
					'https://earthengine.googleapis.com/v1/projects/editorial-democraticprimaries/maps/94b5f391396ca805155405839a43feab-9000c76df80992db42c75a7f8e87b71d/tiles/{z}/{x}/{y}'
			}
		],
		style = 'https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json',
		center = [32.5, 15.6],
		zoom = 7,
		tileSize = 256,
		opacity = 1,
		maxzoom = 10,
		bounds = [
			[19.511719, 8.233237],
			[40.957031, 23.402765]
		],
		minimap = true,
		preload = true,
		// only cache the base level; higher levels are fetched on demand
		preloadZoom = 7
	}: Props = $props();

	let container: HTMLDivElement;
	let map: MapLibreMap | undefined;

	// splash state, driven by the tile-caching pass below
	let loading = $state(preload);
	let cached = $state(0);
	let total = $state(0);
	let progress = $derived(total > 0 ? Math.round((cached / total) * 100) : 0);

	// id of the currently visible ndvi layer
	let active = $state(layers[0]?.id);

	// show one ndvi layer and hide the rest
	function selectLayer(id: string) {
		active = id;
		if (!map) return;
		for (const layer of layers) {
			map.setLayoutProperty(`ndvi-${layer.id}-layer`, 'visibility', layer.id === id ? 'visible' : 'none');
		}
	}

	// slippy-map tile math (web mercator)
	function lngToTileX(lng: number, z: number) {
		return Math.floor(((lng + 180) / 360) * 2 ** z);
	}
	function latToTileY(lat: number, z: number) {
		const r = (lat * Math.PI) / 180;
		return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z);
	}

	// every tile url covering `bounds` at the preload zoom level, for one layer
	function tileUrlsForBounds(tileUrl: string) {
		const [[west, south], [east, north]] = bounds as [[number, number], [number, number]];
		const z = preloadZoom;
		const urls: string[] = [];
		const x0 = lngToTileX(west, z);
		const x1 = lngToTileX(east, z);
		// north is the smaller y in web mercator
		const y0 = latToTileY(north, z);
		const y1 = latToTileY(south, z);
		for (let x = x0; x <= x1; x++) {
			for (let y = y0; y <= y1; y++) {
				urls.push(tileUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)));
			}
		}
		return urls;
	}

	// fetch every tile with a bounded pool so the browser cache is warm before
	// the user interacts. all layers are cached so toggling is instant too.
	// failures are ignored — a missing tile just isn't cached.
	async function warmTileCache() {
		const urls = layers.flatMap((layer) => tileUrlsForBounds(layer.tileUrl));
		total = urls.length;
		let next = 0;
		const workers = Array.from({ length: 12 }, async () => {
			while (next < urls.length) {
				const url = urls[next++];
				try {
					const res = await fetch(url);
					// drain the body so the tile is fully stored in the http cache
					await res.blob();
				} catch {
					// ignore individual tile failures
				}
				cached++;
			}
		});
		await Promise.all(workers);
	}

	onMount(() => {
		// maplibre touches the dom, so load it client-side only
		(async () => {
			const { default: maplibregl } = await import('maplibre-gl');

			map = new maplibregl.Map({
				container,
				style,
				center,
				zoom,
				// clamp zoom-out to the precached base level and zoom-in to maxzoom
				minZoom: preloadZoom,
				maxZoom: maxzoom,
				// restrict panning and zoom-out to the area of interest
				maxBounds: bounds,
				// disable the global tile crossfade for snappier zooming
				fadeDuration: 0
			});

			if (minimap) {
				const { MinimapControl } = await import('./minimap-control');
				map.addControl(new MinimapControl({ maplibregl, style, bounds }), 'bottom-left');
			}

			map.on('load', () => {
				// add every ndvi layer; only the active one starts visible
				for (const layer of layers) {
					map!.addSource(`ndvi-${layer.id}`, {
						type: 'raster',
						tiles: [layer.tileUrl],
						tileSize,
						maxzoom
					});

					map!.addLayer({
						id: `ndvi-${layer.id}-layer`,
						type: 'raster',
						source: `ndvi-${layer.id}`,
						layout: {
							visibility: layer.id === active ? 'visible' : 'none'
						},
						paint: {
							'raster-opacity': opacity,
							'raster-fade-duration': 0
						}
					});
				}

				// sudan national boundary (bundled geojson served from static/)
				map!.addSource('sudan', { type: 'geojson', data: `${base}/sudan-adm0.geojson` });
				map!.addLayer({
					id: 'sudan-boundary',
					type: 'line',
					source: 'sudan',
					paint: {
						'line-color': '#333',
						'line-width': 1.5
					}
				});

				// major towns: a dot plus a labelled name
				map!.addSource('towns', { type: 'geojson', data: towns });
				map!.addLayer({
					id: 'town-dots',
					type: 'circle',
					source: 'towns',
					paint: {
						'circle-radius': ['case', ['get', 'capital'], 5, 3],
						'circle-color': '#c0392b',
						'circle-stroke-color': '#fff',
						'circle-stroke-width': 1
					}
				});
				map!.addLayer({
					id: 'town-labels',
					type: 'symbol',
					source: 'towns',
					layout: {
						'text-field': ['get', 'name'],
						'text-font': ['case', ['get', 'capital'], ['literal', ['Open Sans Bold']], ['literal', ['Open Sans Regular']]],
						'text-size': ['case', ['get', 'capital'], 13, 11],
						'text-anchor': 'top',
						'text-offset': [0, 0.6],
						'text-optional': true
					},
					paint: {
						'text-color': '#1a1a1a',
						'text-halo-color': '#fff',
						'text-halo-width': 1.5
					}
				});

				// country name
				map!.addSource('country-label', { type: 'geojson', data: countryLabel });
				map!.addLayer({
					id: 'country-name',
					type: 'symbol',
					source: 'country-label',
					layout: {
						'text-field': ['get', 'name'],
						'text-font': ['Open Sans Bold'],
						'text-size': 22,
						'text-letter-spacing': 0.3,
						'text-transform': 'uppercase'
					},
					paint: {
						'text-color': '#555',
						'text-halo-color': '#fff',
						'text-halo-width': 1.5
					}
				});
			});

			// warm the tile cache, then lift the splash. run it after the map has
			// been created so both proceed in parallel.
			if (preload) {
				try {
					await warmTileCache();
				} finally {
					loading = false;
				}
			}
		})();

		return () => map?.remove();
	});
</script>

<div class="map" bind:this={container}></div>

{#if !loading && layers.length > 1}
	<div class="toggle" role="group" aria-label="Choose NDVI period">
		{#each layers as layer (layer.id)}
			<button
				type="button"
				class="toggle-btn"
				class:active={layer.id === active}
				aria-pressed={layer.id === active}
				onclick={() => selectLayer(layer.id)}
			>
				{layer.label}
			</button>
		{/each}
	</div>
{/if}

{#if loading}
	<div class="splash" role="status" aria-live="polite">
		<div class="splash-inner">
			<div class="spinner" aria-hidden="true"></div>
			<p class="splash-title">Loading satellite imagery</p>
			<div class="bar">
				<div class="bar-fill" style="width: {progress}%"></div>
			</div>
			<p class="splash-count">{progress}%{#if total > 0}<span class="splash-detail"> · {cached} / {total} tiles</span>{/if}</p>
		</div>
	</div>
{/if}

<style>
	.map {
		width: 100%;
		height: 100vh;
	}

	.toggle {
		position: absolute;
		top: 1rem;
		right: 1rem;
		z-index: 5;
		display: flex;
		background: #fff;
		border-radius: 6px;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
		overflow: hidden;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
	}

	.toggle-btn {
		appearance: none;
		border: none;
		background: transparent;
		padding: 0.5rem 0.85rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: #555;
		cursor: pointer;
		white-space: nowrap;
	}

	.toggle-btn + .toggle-btn {
		border-left: 1px solid rgba(0, 0, 0, 0.1);
	}

	.toggle-btn:hover {
		background: rgba(0, 0, 0, 0.04);
	}

	.toggle-btn.active {
		background: #c0392b;
		color: #fff;
	}

	.splash {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #f4f4f2;
		z-index: 10;
	}

	.splash-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.9rem;
		width: min(280px, 70vw);
		text-align: center;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
		color: #1a1a1a;
	}

	.spinner {
		width: 2rem;
		height: 2rem;
		border: 3px solid rgba(0, 0, 0, 0.12);
		border-top-color: #c0392b;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.splash-title {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
	}

	.bar {
		width: 100%;
		height: 4px;
		border-radius: 2px;
		background: rgba(0, 0, 0, 0.1);
		overflow: hidden;
	}

	.bar-fill {
		height: 100%;
		background: #c0392b;
		transition: width 0.2s ease;
	}

	.splash-count {
		margin: 0;
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
		color: #555;
	}

	.splash-detail {
		color: #888;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}
</style>
