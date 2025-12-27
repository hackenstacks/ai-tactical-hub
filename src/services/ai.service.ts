import { Injectable } from '@angular/core';
import { GoogleGenAI, GenerateContentResponse, Type } from '@google/genai';

@Injectable({
  providedIn: 'root'
})
export class AiService {
  private genAI: GoogleGenAI;
  
  constructor() {
    // Assuming process.env.API_KEY is available in the environment
    this.genAI = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  }

  async generateResponse(
    prompt: string, 
    systemInstruction: string = '', 
    history: {role: 'user' | 'model', text: string}[] = []
  ): Promise<string> {
    try {
      const chatHistory = history.map(h => ({
          role: h.role,
          parts: [{ text: h.text }]
      }));

      const response = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [...chatHistory, { role: 'user', parts: [{ text: prompt }] }],
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.9,
        }
      });

      // FIX: The `text` property on the response is a non-nullable string.
      // An empty string can be a valid response, so we should not treat it as an error.
      return response.text;
    } catch (e) {
      console.error('AI Error', e);
      return '⚠️ SYSTEM FAILURE: CONNECTION SEVERED.';
    }
  }

  async generateImage(prompt: string): Promise<string | null> {
    try {
      const response = await this.genAI.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: prompt,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/jpeg'
        }
      });
      
      const bytes = response.generatedImages?.[0]?.image?.imageBytes;
      if (bytes) {
        return `data:image/jpeg;base64,${bytes}`;
      }
      return null;
    } catch (e) {
      console.error('Image Gen Error', e);
      return null;
    }
  }

  async browseUrl(url: string): Promise<{ summary: string; images: string[] }> {
    try {
      const response = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Please act as a text-based web browser. Analyze the content of the following URL and provide a concise summary and a list of up to 3 relevant image URLs from the page. URL: ${url}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING, description: 'A concise summary of the webpage content.' },
              images: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'An array of up to 3 image URLs found on the page.' }
            }
          }
        }
      });

      const parsed = JSON.parse(response.text);
      return parsed;
    } catch (e) {
      console.error('URL Browsing Error', e);
      return { summary: 'Failed to access or parse the URL content.', images: [] };
    }
  }

  async generateTerminalCommand(request: string): Promise<string> {
    try {
      const response = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Based on the following user request, generate a single, valid Linux/bash shell command. Only output the command itself, with no explanation or extra text. Request: "${request}"`,
      });
      // Clean up potential markdown code blocks
      return response.text.replace(/`/g, '').trim();
    } catch (e) {
      console.error('Terminal Command Gen Error', e);
      return `echo "Error processing request: ${request}"`;
    }
  }
}