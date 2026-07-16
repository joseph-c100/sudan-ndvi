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
		// show the legend / layer-explainer box above the minimap
		info?: boolean;
		// warm the browser tile cache in the background so panning/toggling is
		// instant. set preload={false} to skip.
		preload?: boolean;
		// single zoom level whose tiles are warmed in the background
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
		info = true,
		preload = true,
		// only cache the base level; higher levels are fetched on demand
		preloadZoom = 7
	}: Props = $props();

	let container: HTMLDivElement;
	let map: MapLibreMap | undefined;

	// id of the currently visible ndvi layer
	let active = $state(layers[0]?.id);

	// show one ndvi layer and hide the rest
	function selectLayer(id: string) {
		active = id;
		if (!map) return;
		for (const layer of layers) {
			map.setLayoutProperty(
				`ndvi-${layer.id}-layer`,
				'visibility',
				layer.id === id ? 'visible' : 'none'
			);
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
				urls.push(
					tileUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
				);
			}
		}
		return urls;
	}

	// fetch every tile with a bounded pool so the browser cache is warm before
	// the user interacts. failures are ignored — a missing tile just isn't cached.
	async function warmTileCache(targetLayers: NdviLayer[]) {
		const urls = targetLayers.flatMap((layer) => tileUrlsForBounds(layer.tileUrl));
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
				fadeDuration: 0,
				// ndvi tiles are immutable, so never re-request expired ones
				refreshExpiredTiles: false
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
						'circle-radius': ['case', ['get', 'capital'], 6, 4],
						'circle-color': '#000',
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
						'text-font': [
							'case',
							['get', 'capital'],
							['literal', ['Open Sans Bold']],
							['literal', ['Open Sans Regular']]
						],
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

			// warm the tile cache in the background so panning and toggling are
			// snappy; this never blocks the map from showing.
			if (preload) {
				const activeLayer = layers.find((l) => l.id === active);
				const ordered = activeLayer
					? [activeLayer, ...layers.filter((l) => l.id !== active)]
					: layers;
				warmTileCache(ordered);
			}
		})();

		return () => map?.remove();
	});
</script>

<div class="map" bind:this={container}></div>

{#if layers.length > 1}
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

{#if info}
	<div class="info" class:above-minimap={minimap}>
		<p class="info-title">Median vegetation and farmland change before and during conflict</p>
		<p class="info-key-title">Change key</p>
		<div class="info-key-bar" aria-hidden="true"></div>
		<div class="info-key-labels">
			<span>Loss</span>
			<span>Gain</span>
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
		overflow: hidden;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
	}

	.toggle-btn {
		appearance: none;
		border: 1px solid black;
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
		background: #000;
		color: #fff;
	}

	.info {
		position: absolute;
		left: 10px;
		bottom: 10px;
		z-index: 5;
		width: 200px;
		box-sizing: border-box;
		padding: 0.6rem 0.7rem;
		background: #fff;
		border: 1px solid #000;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
		font-size: 0.72rem;
		line-height: 1.35;
		color: #1a1a1a;
	}

	/* lift above the 150px-tall minimap (plus its 10px margin and a gap) */
	.info.above-minimap {
		bottom: 170px;
	}

	.info-title {
		margin: 0 0 0.4rem;
		font-size: 0.8rem;
		font-weight: 700;
	}

	.info-layers {
		margin: 0 0 0.55rem;
		padding-left: 0.9rem;
	}

	.info-layers li {
		margin-bottom: 0.2rem;
	}

	.info-key-title {
		margin: 0 0 0.3rem;
		font-weight: 700;
	}

	.info-key-bar {
		height: 10px;
		border: 1px solid #000;
		/* red = loss, through neutral, to green = gain */
		background: linear-gradient(to right, #c0392b, #f7f7f7, #2e7d32);
	}

	.info-key-labels {
		display: flex;
		justify-content: space-between;
		margin-top: 0.2rem;
		color: #555;
	}
</style>
