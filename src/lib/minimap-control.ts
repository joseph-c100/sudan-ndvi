import type maplibregl from 'maplibre-gl';
import type {
	IControl,
	Map as MapLibreMap,
	StyleSpecification,
	LngLatBoundsLike,
	GeoJSONSource
} from 'maplibre-gl';
import type { Feature, Polygon } from 'geojson';

interface MinimapOptions {
	// the maplibre-gl module default export (dynamically imported client-side)
	maplibregl: typeof maplibregl;
	// basemap style for the minimap (same as the main map by default)
	style: string | StyleSpecification;
	// area the minimap frames, [[west, south], [east, north]]
	bounds: LngLatBoundsLike;
	width?: string;
	height?: string;
}

// a maplibre plugin (IControl) that shows a small overview map with a
// rectangle marking the main map's current viewport. click to recenter.
export class MinimapControl implements IControl {
	private options: MinimapOptions;
	private container!: HTMLDivElement;
	private mini!: MapLibreMap;
	private parent!: MapLibreMap;

	constructor(options: MinimapOptions) {
		this.options = options;
	}

	onAdd(map: MapLibreMap): HTMLElement {
		this.parent = map;
		const { maplibregl, style, bounds } = this.options;

		this.container = document.createElement('div');
		this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group minimap';
		this.container.style.width = this.options.width ?? '200px';
		this.container.style.height = this.options.height ?? '150px';
		this.container.style.overflow = 'hidden';

		this.mini = new maplibregl.Map({
			container: this.container,
			style,
			interactive: false,
			attributionControl: false
		});

		this.mini.on('load', () => {
			this.mini.addSource('viewport', { type: 'geojson', data: this.viewportPolygon() });
			this.mini.addLayer({
				id: 'viewport-fill',
				type: 'fill',
				source: 'viewport',
				paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.15 }
			});
			this.mini.addLayer({
				id: 'viewport-line',
				type: 'line',
				source: 'viewport',
				paint: { 'line-color': '#3b82f6', 'line-width': 1.5 }
			});

			this.sync();
		});

		// the container isn't in the dom yet at construction, so the map can
		// initialise at 0x0. resize once laid out, then frame the full area.
		requestAnimationFrame(() => {
			this.mini.resize();
			this.mini.fitBounds(bounds, { padding: 4, animate: false });
		});

		this.parent.on('move', this.sync);

		// click the minimap to recenter the main map there
		this.container.addEventListener('click', (event) => {
			const rect = this.container.getBoundingClientRect();
			const lngLat = this.mini.unproject([event.clientX - rect.left, event.clientY - rect.top]);
			this.parent.easeTo({ center: lngLat });
		});

		return this.container;
	}

	onRemove(): void {
		this.parent.off('move', this.sync);
		this.mini?.remove();
		this.container?.remove();
	}

	// keep the viewport rectangle in step with the main map
	private sync = (): void => {
		const source = this.mini?.getSource('viewport') as GeoJSONSource | undefined;
		source?.setData(this.viewportPolygon());
	};

	private viewportPolygon(): Feature<Polygon> {
		const b = this.parent.getBounds();
		const w = b.getWest();
		const s = b.getSouth();
		const e = b.getEast();
		const n = b.getNorth();
		return {
			type: 'Feature',
			properties: {},
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[w, s],
						[e, s],
						[e, n],
						[w, n],
						[w, s]
					]
				]
			}
		};
	}
}
