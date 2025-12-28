import { Injectable } from '@angular/core';
import { GoogleGenAI, GenerateContentResponse, Type } from '@google/genai';

export interface BrowseResult {
  title: string;
  content: string;
  images: string[];
}

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

  async browseUrl(url: string, options: { mode: 'summary' | 'reader' | 'search', includeImages: boolean, query?: string }): Promise<BrowseResult> {
    try {
      let prompt = '';
      if (options.mode === 'search') {
        prompt = `Act as a search engine. Perform a search on ${url} for the query: "${options.query}". Provide a comprehensive summary of the search results found.`;
      } else if (options.mode === 'reader') {
        prompt = `Act as a reader mode browser. Fetch and extract the full main text content from the URL: ${url}. Return the full text clearly formatted as paragraphs. Do not summarize.`;
      } else {
        prompt = `Act as a web browser. Analyze the content of the URL: ${url}. Provide a concise summary of the page content.`;
      }

      if (options.includeImages) {
        prompt += ` Also find up to 4 relevant image URLs on the page.`;
      } else {
        prompt += ` Do not extract any images.`;
      }

      const response = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'The title of the page or search query.' },
              content: { type: Type.STRING, description: 'The main text content, summary, or search results.' },
              images: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Relevant image URLs found.' }
            }
          }
        }
      });

      const parsed = JSON.parse(response.text);
      return parsed as BrowseResult;
    } catch (e) {
      console.error('URL Browsing Error', e);
      return { title: 'Error', content: 'Failed to access or parse the URL content.', images: [] };
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