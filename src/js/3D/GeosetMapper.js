/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Martin Benjamins <marlamin@marlamin.com>
	License: MIT
 */

const GEOSET_GROUPS = {
	0: 'Head',
	100: 'Beard',
	200: 'Sideburns',
	300: 'Moustache',
	400: 'Gloves',
	500: 'Boots',
	600: 'Shirt/Tail',
	700: 'Ears',
	800: 'WristSleeves',
	900: 'Legs',
	1000: 'Chest',
	1100: 'Pants',
	1200: 'Tabard',
	1300: 'Robe',
	1400: 'Loincloth',
	1500: 'Cape',
	1600: 'Jewelry/Chins',
	1700: 'Eyeglow',
	1800: 'Belt',
	1900: 'Bone/Tail',
	2000: 'Feet',
	2200: 'Torso',
	2300: 'HandAttach',
	2400: 'HeadAttach',
	2500: 'DHBlindfolds',
	2700: 'Head',
	2800: 'Chest',
	2900: 'MechagnomeArms',
	3000: 'MechagnomeLegs',
	3100: 'MechagnomeFeet',
	3200: 'Face',
	3300: 'Eyes',
	3400: 'Eyebrows',
	3500: 'Earrings',
	3600: 'Necklace',
	3700: 'Headdress',
	3800: 'Tails',
	3900: 'Vines',
	4000: 'Chins/Tusks',
	4100: 'Noses',
	4200: 'HairDecoration',
	4300: 'HornDecoration'
};

/**
 * Get the label for a geoset based on the group.
 * @param {number} index
 * @param {number} id
 */
const getGeosetName = (index, id) => {
	if (id === 0)
		return 'Geoset' + index;

	const base = Math.floor(id / 100) * 100;
	const group = GEOSET_GROUPS[base];

	if (group)
		return group + (id - base);

	return 'Geoset' + index + '_' + base;
};

/**
 * Map geoset names for subMeshes.
 * @param {Array} geosets
 */
const map = async (geosets) => {
	for (let i = 0, n = geosets.length; i < n; i++) {
		const geoset = geosets[i];
		geoset.label = getGeosetName(i, geoset.id);
	}
};

module.exports = { map, getGeosetName };
