// import { provinces } from './provinces';
import { regions } from './regions';

// const allLocations = [...provinces, ...regions];
const allLocations = regions;

export const locationCodes = allLocations.map((e) => e.code);
export type LocationCode = (typeof locationCodes)[number];

export const isValidLocationCode = (code: string): code is LocationCode => {
  return locationCodes.includes(code as LocationCode);
};
