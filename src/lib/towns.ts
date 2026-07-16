import type { FeatureCollection, Point } from 'geojson';

// major sudanese towns. capital flag drives dot size / label weight.
export const towns: FeatureCollection<Point, { name: string; capital: boolean }> = {
	type: 'FeatureCollection',
	features: [
		['Khartoum', 32.53, 15.59, true],
		['Omdurman', 32.48, 15.64, false],
		['Port Sudan', 37.22, 19.62, false],
		['El Fasher', 25.35, 13.63, false],
		['El Obeid', 30.22, 13.18, false],
		['Nyala', 24.88, 12.05, false],
		['Kassala', 36.4, 15.46, false],
		['Wad Madani', 33.52, 14.4, false],
		['Gedaref', 35.38, 14.04, false],
		['Kosti', 32.66, 13.17, false],
		['El Geneina', 22.45, 13.45, false],
		['Dongola', 30.48, 19.16, false],
		['Atbara', 33.99, 17.7, false],
		['Kadugli', 29.72, 11.01, false]
	].map(([name, lng, lat, capital]) => ({
		type: 'Feature',
		properties: { name: name as string, capital: capital as boolean },
		geometry: { type: 'Point', coordinates: [lng as number, lat as number] }
	}))
};

// point used to place the country name label
export const countryLabel: FeatureCollection<Point, { name: string }> = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			properties: { name: 'SUDAN' },
			geometry: { type: 'Point', coordinates: [29.8, 16.2] }
		}
	]
};
