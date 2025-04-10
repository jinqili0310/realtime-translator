import { Language } from '../types';

export const detectLanguage = (text: string): Language | null => {
  console.log('Using consolidated language detection with text:', text);
  
  if (!text || text === "[inaudible]" || text === "[Transcribing...]") {
    console.log('No language detected (invalid text)');
    return null;
  }
  
  // Clean the text by removing any non-alphabetic characters
  const cleanText = text.replace(/[^a-zA-Z\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\u0600-\u06ff\u0400-\u04ff]/g, '');
  
  // Chinese characters
  if (/[\u4e00-\u9fff]/.test(cleanText)) {
    console.log('Detected Chinese');
    return { code: "zh", name: "Chinese" };
  }
  // Japanese characters (Hiragana and Katakana)
  else if (/[\u3040-\u309f\u30a0-\u30ff]/.test(cleanText)) {
    console.log('Detected Japanese');
    return { code: "ja", name: "Japanese" };
  }
  // Korean characters
  else if (/[\uac00-\ud7af]/.test(cleanText)) {
    console.log('Detected Korean');
    return { code: "ko", name: "Korean" };
  }
  // Arabic characters
  else if (/[\u0600-\u06ff]/.test(cleanText)) {
    console.log('Detected Arabic');
    return { code: "ar", name: "Arabic" };
  }
  // Russian characters
  else if (/[\u0400-\u04ff]/.test(cleanText)) {
    console.log('Detected Russian');
    return { code: "ru", name: "Russian" };
  }
  // Spanish/Portuguese special characters
  else if (/[áéíóúüñ¿¡]/.test(cleanText)) {
    console.log('Detected Spanish');
    return { code: "es", name: "Spanish" };
  }
  // German special characters
  else if (/[äöüßÄÖÜ]/.test(cleanText)) {
    console.log('Detected German');
    return { code: "de", name: "German" };
  }
  // French special characters
  else if (/[àâçéèêëîïôùûüÿœæ]/.test(cleanText)) {
    console.log('Detected French');
    return { code: "fr", name: "French" };
  }
  // Default to English for Latin script
  else if (/[a-zA-Z]/.test(cleanText)) {
    console.log('Detected English');
    return { code: "en", name: "English" };
  }
  
  console.log('No language detected');
  return null;
};

// Helper function to get language code only
export const detectLanguageCode = (text: string): string | null => {
  const language = detectLanguage(text);
  return language ? language.code : null;
};

export const detectLanguageSimple = (text: string): string | null => {
  console.log('Using languageDetection.ts detectLanguageSimple with text:', text);
  if (!text || text === "[inaudible]" || text === "[Transcribing...]") {
    console.log('No language detected (invalid text)');
    return null;
  }

  // Chinese characters
  if (/[\u4e00-\u9fff]/.test(text)) {
    console.log('Detected Chinese (simple)');
    return "zh";
  }
  // Japanese characters (Hiragana and Katakana)
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) {
    console.log('Detected Japanese (simple)');
    return "ja";
  }
  // Korean characters
  if (/[\uac00-\ud7af]/.test(text)) {
    console.log('Detected Korean (simple)');
    return "ko";
  }
  // Arabic characters
  if (/[\u0600-\u06ff]/.test(text)) {
    console.log('Detected Arabic (simple)');
    return "ar";
  }
  // Russian characters
  if (/[\u0400-\u04ff]/.test(text)) {
    console.log('Detected Russian (simple)');
    return "ru";
  }
  // Spanish/Portuguese special characters
  if (/[áéíóúüñ¿¡]/.test(text)) {
    console.log('Detected Spanish (simple)');
    return "es";
  }
  // German special characters
  if (/[äöüßÄÖÜ]/.test(text)) {
    console.log('Detected German (simple)');
    return "de";
  }
  // French special characters
  if (/[àâçéèêëîïôùûüÿœæ]/.test(text)) {
    console.log('Detected French (simple)');
    return "fr";
  }
  // Default to English for Latin script
  if (/[a-zA-Z]/.test(text)) {
    console.log('Detected English (simple)');
    return "en";
  }

  console.log('No language detected (simple)');
  return null;
}; 