import { Schema, Type } from '@google/genai';
import { locationCodes } from '@/shared/constants/location-codes';
import { RegionCode } from '@/shared/constants/regions';
import { LocationType } from '@/shared/enums';
import { locationCodesDesc } from './benchmark-strike.schema';

export const benchmarkAiGoogleSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    isStrike: { type: Type.BOOLEAN },
    strikeData: {
      type: Type.OBJECT,
      properties: {
        startDate: {
          type: Type.STRING,
          description: 'Format yyyy-MM-dd HH:mm:ss',
        },
        endDate: {
          type: Type.STRING,
          description: 'Format yyyy-MM-dd HH:mm:ss',
        },
        locationType: {
          type: Type.STRING,
          description: 'Location type of the strike',
          example: LocationType.REGION,
          enum: Object.values(LocationType),
        },
        locationCodes: {
          type: Type.ARRAY,
          description: locationCodesDesc,
          items: {
            type: Type.STRING,
            enum: locationCodes, // includes both region and province codes
          },
          example: ['03'] satisfies RegionCode[], // Lombardia
        },
        guaranteedTimes: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Time ranges in format HH:mm-HH:mm (e.g. 06:00-09:00)',
        },
      },
      required: ['startDate', 'endDate', 'locationType'],
    },
  },
  required: ['isStrike'],
};
