import { provinces } from './provinces';
import { regions } from './regions';

const allLocations = [...provinces, ...regions];

export const locationCodes = allLocations.map((e) => e.code);
export type LocationCode = (typeof locationCodes)[number];

export const isValidLocationCode = (code: string): code is LocationCode => {
  return locationCodes.includes(code as LocationCode);
};

const locationNamesObj = Object.fromEntries(
  allLocations.map((loc) => [loc.code, loc.name]),
) as Record<LocationCode, string>;

/**
 * Get the name of a location (region or province) given its code
 * @param code - The location code (2-digit string for regions, 2-letter string for provinces)
 * @param type - Optional location type to optimize lookup (REGION or PROVINCE)
 * @returns The name of the location or undefined if not found
 */
export const getLocationName = (code: LocationCode): string | undefined => {
  return locationNamesObj[code];
};
