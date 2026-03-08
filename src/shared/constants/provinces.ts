import { groupBy, mapValues } from 'lodash-es';
import type { RegionCode } from './regions';

export const provincesArr = [
  ['Agrigento', 'AG', '19'],
  ['Alessandria', 'AL', '01'],
  ['Ancona', 'AN', '11'],
  ["Valle d'Aosta", 'AO', '02'],
  ['Arezzo', 'AR', '09'],
  ['Ascoli Piceno', 'AP', '11'],
  ['Asti', 'AT', '01'],
  ['Avellino', 'AV', '15'],
  ['Bari', 'BA', '16'],
  ['Barletta-Andria-Trani', 'BT', '16'],
  ['Belluno', 'BL', '05'],
  ['Benevento', 'BN', '15'],
  ['Bergamo', 'BG', '03'],
  ['Biella', 'BI', '01'],
  ['Bologna', 'BO', '08'],
  ['Bolzano', 'BZ', '04'],
  ['Brescia', 'BS', '03'],
  ['Brindisi', 'BR', '16'],
  ['Cagliari', 'CA', '20'],
  ['Caltanissetta', 'CL', '19'],
  ['Campobasso', 'CB', '14'],
  ['Caserta', 'CE', '15'],
  ['Catania', 'CT', '19'],
  ['Catanzaro', 'CZ', '18'],
  ['Chieti', 'CH', '13'],
  ['Como', 'CO', '03'],
  ['Cosenza', 'CS', '18'],
  ['Cremona', 'CR', '03'],
  ['Crotone', 'KR', '18'],
  ['Cuneo', 'CN', '01'],
  ['Enna', 'EN', '19'],
  ['Fermo', 'FM', '11'],
  ['Ferrara', 'FE', '08'],
  ['Firenze', 'FI', '09'],
  ['Foggia', 'FG', '16'],
  ['Forlì-Cesena', 'FC', '08'],
  ['Frosinone', 'FR', '12'],
  ['Genova', 'GE', '07'],
  ['Gorizia', 'GO', '06'],
  ['Grosseto', 'GR', '09'],
  ['Imperia', 'IM', '07'],
  ['Isernia', 'IS', '14'],
  ["L'Aquila", 'AQ', '13'],
  ['La Spezia', 'SP', '07'],
  ['Latina', 'LT', '12'],
  ['Lecce', 'LE', '16'],
  ['Lecco', 'LC', '03'],
  ['Livorno', 'LI', '09'],
  ['Lodi', 'LO', '03'],
  ['Lucca', 'LU', '09'],
  ['Macerata', 'MC', '11'],
  ['Mantova', 'MN', '03'],
  ['Massa-Carrara', 'MS', '09'],
  ['Matera', 'MT', '17'],
  ['Messina', 'ME', '19'],
  ['Milano', 'MI', '03'],
  ['Modena', 'MO', '08'],
  ['Monza e Brianza', 'MB', '03'],
  ['Napoli', 'NA', '15'],
  ['Novara', 'NO', '01'],
  ['Nuoro', 'NU', '20'],
  ['Oristano', 'OR', '20'],
  ['Padova', 'PD', '05'],
  ['Palermo', 'PA', '19'],
  ['Parma', 'PR', '08'],
  ['Pavia', 'PV', '03'],
  ['Perugia', 'PG', '10'],
  ['Pesaro e Urbino', 'PU', '11'],
  ['Pescara', 'PE', '13'],
  ['Piacenza', 'PC', '08'],
  ['Pisa', 'PI', '09'],
  ['Pistoia', 'PT', '09'],
  ['Pordenone', 'PN', '06'],
  ['Potenza', 'PZ', '17'],
  ['Prato', 'PO', '09'],
  ['Ragusa', 'RG', '19'],
  ['Ravenna', 'RA', '08'],
  ['Reggio Calabria', 'RC', '18'],
  ['Reggio Emilia', 'RE', '08'],
  ['Rieti', 'RI', '12'],
  ['Rimini', 'RN', '08'],
  ['Roma', 'RM', '12'],
  ['Rovigo', 'RO', '05'],
  ['Salerno', 'SA', '15'],
  ['Sassari', 'SS', '20'],
  ['Siena', 'SI', '09'],
  ['Siracusa', 'SR', '19'],
  ['Sondrio', 'SO', '03'],
  ['Sud Sardegna', 'SU', '20'],
  ['Teramo', 'TE', '13'],
  ['Terni', 'TR', '10'],
  ['Torino', 'TO', '01'],
  ['Trapani', 'TP', '19'],
  ['Trento', 'TN', '04'],
  ['Treviso', 'TV', '05'],
  ['Trieste', 'TS', '06'],
  ['Udine', 'UD', '06'],
  ['Varese', 'VA', '03'],
  ['Venezia', 'VE', '05'],
  ['Verbano-Cusio-Ossola', 'VB', '01'],
  ['Vercelli', 'VC', '01'],
  ['Verona', 'VR', '05'],
  ['Vibo Valentia', 'VV', '18'],
  ['Vicenza', 'VI', '05'],
  ['Viterbo', 'VT', '12'],
] as const;

export type ProvinceCode = (typeof provincesArr)[number][1];
export const provinceCodes: ProvinceCode[] = provincesArr.map((p) => p[1]);
export const isProvinceCode = (code: string): code is ProvinceCode => {
  return provinceCodes.includes(code as ProvinceCode);
};

export const provinces = provincesArr.map(([name, code, region]) => ({
  name,
  code,
  region,
})) as {
  name: string;
  code: ProvinceCode;
  region: RegionCode;
}[];

export const isProvinceInRegion = (
  provinceCode: string,
  regionCode: string,
): boolean => {
  const province = provinces.find((p) => p.code === provinceCode);
  return !!regionCode && province?.region === regionCode;
};

export const getRegionCodeForProvince = (
  provinceCode: ProvinceCode,
): RegionCode => {
  const province = provinces.find((p) => p.code === provinceCode);
  if (!province) {
    // this would be a serious error
    throw new Error(`Invalid province code: ${provinceCode}`);
  }
  return province.region;
};

export const regionToProvincesMap: Record<RegionCode, ProvinceCode[]> =
  mapValues(
    groupBy(provinces, 'region') as Record<RegionCode, typeof provinces>,
    (items) => items.map((p) => p.code),
  );
