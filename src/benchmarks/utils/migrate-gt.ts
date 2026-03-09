// migrate-gt.ts
import { readFileSync, writeFileSync } from 'fs';
import { getRegionCodeForProvince } from '../../shared/constants/provinces';

const gtPath = '../data/ground-truth.ts';
let content = readFileSync(gtPath, 'utf-8');

// 1. Sostituiamo i locationType
content = content.replace(
  /locationType:\s*'PROVINCE'/g,
  "locationType: 'REGIONAL'",
);
content = content.replace(
  /locationType:\s*'REGION'/g,
  "locationType: 'REGIONAL'",
); // Già che ci siamo, allineiamo anche REGION a REGIONAL

// 2. Sostituiamo i locationCodes delle province (2 lettere) con quelli delle regioni (2 cifre)
// Cerca pattern tipo: locationCodes: ['RM']
const codesRegex = /locationCodes:\s*\[\s*'([A-Z]{2})'\s*\]/g;

content = content.replace(codesRegex, (match, provCode) => {
  const regionCode = getRegionCodeForProvince(provCode);
  if (!regionCode) {
    console.warn(
      `⚠️ Attenzione: Nessun mapping regionale trovato per la provincia ${provCode}`,
    );
    return match; // Lascia intatto se non lo trova
  }
  return `locationCodes: ['${regionCode}']`;
});

writeFileSync(gtPath, content, 'utf-8');
console.log('✅ Migrazione Ground Truth completata!');
