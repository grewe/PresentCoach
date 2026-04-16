

import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
//run .env file
//require('dotenv').config(); // optional if using .env
//const {GoogleGenAI} = require('@google/genai');

const GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
const GOOGLE_CLOUD_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'global';

//print out env acessed variables
console.log('PROJECT:', process.env.GOOGLE_CLOUD_PROJECT);
console.log('LOCATION:', process.env.GOOGLE_CLOUD_LOCATION);


async function generateContent(
  projectId = GOOGLE_CLOUD_PROJECT,
  location = GOOGLE_CLOUD_LOCATION
) {
  const client = new GoogleGenAI({
    vertexai: true,
    project: projectId,
    location: location,
  });

  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: 'How does AI work?',
  });

  console.log(response.text);

  return response.text;
}


//call generateContent
generateContent().catch(console.error);