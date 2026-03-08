export const regionsArr = [
  ['01', 'Piemonte'],
  ['02', "Valle d'Aosta"],
  ['03', 'Lombardia'],
  ['04', 'Trentino-Alto Adige'],
  ['05', 'Veneto'],
  ['06', 'Friuli-Venezia Giulia'],
  ['07', 'Liguria'],
  ['08', 'Emilia-Romagna'],
  ['09', 'Toscana'],
  ['10', 'Umbria'],
  ['11', 'Marche'],
  ['12', 'Lazio'],
  ['13', 'Abruzzo'],
  ['14', 'Molise'],
  ['15', 'Campania'],
  ['16', 'Puglia'],
  ['17', 'Basilicata'],
  ['18', 'Calabria'],
  ['19', 'Sicilia'],
  ['20', 'Sardegna'],
] as const;

export type RegionCode = (typeof regionsArr)[number][0];
export const regionCodes: RegionCode[] = regionsArr.map((r) => r[0]);
export const isRegionCode = (code: string): code is RegionCode => {
  return regionCodes.includes(code as RegionCode);
};

export const regions = regionsArr.map(([code, name]) => ({ code, name })) as {
  code: RegionCode;
  name: (typeof regionsArr)[number][1];
}[];

export const getRegionName = (code: string): string | null => {
  const region = regions.find((r) => r.code === code);
  return region ? region.name : null;
};
